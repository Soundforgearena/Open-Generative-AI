-- Applied to production as version 20260903163047 (cinexvideo_credit_packs_and_purchase).
-- Content exported verbatim from supabase_migrations.schema_migrations.

create table if not exists public.credit_packs (
  code text primary key,
  name text not null,
  credits integer not null check (credits > 0),
  price_cents integer not null check (price_cents > 0),
  blurb text,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.credit_packs enable row level security;
drop policy if exists credit_packs_read on public.credit_packs;
create policy credit_packs_read on public.credit_packs for select using (active);

-- Price ladder mirrors billing_plans so pack and subscription pricing agree.
insert into public.credit_packs(code, name, credits, price_cents, blurb, sort_order) values
  ('creator', 'Creator',  300,  1900, 'A short film or a music video.', 1),
  ('studio',  'Studio',  1000,  4900, 'A full episode with room to iterate.', 2),
  ('pro',     'Pro',     2500,  9900, 'Best value per credit for heavy production.', 3)
on conflict (code) do update set
  credits = excluded.credits, price_cents = excluded.price_cents,
  name = excluded.name, blurb = excluded.blurb, sort_order = excluded.sort_order;

-- Revenue is recognised when credits are CONSUMED, not when they are bought.
-- Unspent credits are a liability, and the provider cost of a generation is not
-- incurred until the generation runs. Splitting at purchase time would pay
-- partners on revenue whose cost of goods had not happened yet, leaving the
-- platform to absorb 100% of the later provider bill alone.
--
-- To make that work we track what each credit was actually sold for, net of
-- payment fees, as a running weighted average per wallet. Free promotional
-- credits carry a rate of 0, so generations paid for with them correctly
-- produce no partner payout and the platform absorbs the promo cost.
alter table public.credit_wallets
  add column if not exists net_cents_per_credit numeric(10,4) not null default 0;

create or replace function public.fulfil_credit_purchase(
  p_user_id uuid,
  p_credits integer,
  p_amount_cents integer,
  p_fee_cents integer,
  p_provider text,
  p_provider_payment_id text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_existing public.payment_records%rowtype;
  v_net numeric;
  v_old_balance integer;
  v_old_rate numeric;
  v_new_rate numeric;
begin
  -- Stripe retries webhooks. Fulfil at most once per payment.
  select * into v_existing from public.payment_records
   where provider = p_provider and provider_payment_id = p_provider_payment_id;
  if found then
    return jsonb_build_object('status','already_fulfilled','credits',v_existing.credits);
  end if;

  if p_credits <= 0 or p_amount_cents <= 0 then
    raise exception 'Invalid purchase amount';
  end if;

  perform public.get_or_create_credit_wallet(p_user_id);

  select balance, net_cents_per_credit into v_old_balance, v_old_rate
    from public.credit_wallets where user_id = p_user_id for update;

  v_net := greatest(p_amount_cents - coalesce(p_fee_cents,0), 0);

  -- Weighted average of what the credits now in the wallet were sold for.
  v_new_rate := case
    when (v_old_balance + p_credits) = 0 then 0
    else ((coalesce(v_old_balance,0) * coalesce(v_old_rate,0)) + v_net) / (v_old_balance + p_credits)
  end;

  update public.credit_wallets
     set balance = balance + p_credits,
         lifetime_purchased = lifetime_purchased + p_credits,
         net_cents_per_credit = v_new_rate,
         updated_at = now()
   where user_id = p_user_id;

  insert into public.credit_ledger(user_id, amount, entry_type, reference_id, description)
  values (p_user_id, p_credits, 'purchase', p_provider_payment_id,
          format('Purchased %s credits', p_credits));

  insert into public.payment_records(user_id, provider, provider_payment_id, amount_cents, credits, status)
  values (p_user_id, p_provider, p_provider_payment_id, p_amount_cents, p_credits, 'succeeded');

  return jsonb_build_object('status','fulfilled','credits',p_credits,'rate',v_new_rate);
end;
$$;

revoke all on function public.fulfil_credit_purchase(uuid, integer, integer, integer, text, text) from public, anon, authenticated;

-- Called when a generation completes. Values the consumed credits at what the
-- customer actually paid for them, subtracts the real provider cost, and hands
-- the result to the split engine.
create or replace function public.settle_generation_revenue(
  p_user_id uuid,
  p_reference_id text,
  p_credits integer,
  p_provider_cost_cents integer
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_rate numeric; v_gross integer;
begin
  select net_cents_per_credit into v_rate from public.credit_wallets where user_id = p_user_id;
  v_gross := round(coalesce(v_rate,0) * coalesce(p_credits,0))::integer;

  -- Payment fees were already netted out of the per-credit rate at purchase.
  return public.record_revenue(
    'generation', p_reference_id, p_user_id,
    v_gross, coalesce(p_provider_cost_cents,0), 0, 0
  );
end;
$$;

revoke all on function public.settle_generation_revenue(uuid, text, integer, integer) from public, anon, authenticated;
