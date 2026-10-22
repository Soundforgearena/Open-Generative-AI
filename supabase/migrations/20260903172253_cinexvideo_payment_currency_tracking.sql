-- Applied to production as version 20260903172253 (cinexvideo_payment_currency_tracking).
-- Content exported verbatim from supabase_migrations.schema_migrations.

-- Customers are always charged in USD. The Stripe account settles in its own
-- currency, so the amount that actually lands can differ after conversion.
-- Both are recorded: `amount_cents`/`currency` is what the customer paid,
-- `settled_*` is what was banked. The revenue split uses the settled figures,
-- because partners can only be paid out of money actually received.
alter table public.payment_records
  add column if not exists currency text not null default 'usd',
  add column if not exists settled_amount_cents integer,
  add column if not exists settled_currency text,
  add column if not exists fee_cents integer;

comment on column public.payment_records.amount_cents is 'Amount charged to the customer, in `currency` (always USD for CinexVideo).';
comment on column public.payment_records.settled_amount_cents is 'Gross amount credited to the Stripe balance, in settled_currency, before fees.';
comment on column public.payment_records.fee_cents is 'Actual Stripe fee in settled_currency, including any conversion fee.';

create or replace function public.fulfil_credit_purchase(
  p_user_id uuid,
  p_credits integer,
  p_amount_cents integer,
  p_fee_cents integer,
  p_provider text,
  p_provider_payment_id text,
  p_currency text default 'usd',
  p_settled_amount_cents integer default null,
  p_settled_currency text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_existing public.payment_records%rowtype;
  v_settled integer;
  v_net numeric;
  v_old_balance integer;
  v_old_rate numeric;
  v_new_rate numeric;
begin
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

  -- Value the credits at money actually received, not the sticker price.
  v_settled := coalesce(p_settled_amount_cents, p_amount_cents);
  v_net := greatest(v_settled - coalesce(p_fee_cents, 0), 0);

  v_new_rate := case
    when (coalesce(v_old_balance,0) + p_credits) = 0 then 0
    else ((coalesce(v_old_balance,0) * coalesce(v_old_rate,0)) + v_net) / (coalesce(v_old_balance,0) + p_credits)
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

  insert into public.payment_records(
    user_id, provider, provider_payment_id, amount_cents, credits, status,
    currency, settled_amount_cents, settled_currency, fee_cents)
  values (
    p_user_id, p_provider, p_provider_payment_id, p_amount_cents, p_credits, 'completed',
    lower(coalesce(p_currency,'usd')), v_settled, lower(coalesce(p_settled_currency, p_currency, 'usd')),
    coalesce(p_fee_cents,0));

  return jsonb_build_object('status','fulfilled','credits',p_credits,'rate',v_new_rate,'net',v_net);
end;
$$;

revoke all on function public.fulfil_credit_purchase(uuid,integer,integer,integer,text,text,text,integer,text) from public, anon, authenticated;

-- Reporting view: every CinexVideo payment, plainly labelled.
create or replace view public.cinexvideo_payments as
select
  pr.created_at,
  pr.provider_payment_id,
  u.email,
  pr.credits,
  round(pr.amount_cents / 100.0, 2) as charged,
  upper(pr.currency) as charged_currency,
  round(pr.settled_amount_cents / 100.0, 2) as settled_gross,
  round(pr.fee_cents / 100.0, 2) as stripe_fee,
  round((pr.settled_amount_cents - pr.fee_cents) / 100.0, 2) as settled_net,
  upper(pr.settled_currency) as settled_currency,
  pr.status
from public.payment_records pr
left join auth.users u on u.id = pr.user_id
where pr.provider = 'stripe'
order by pr.created_at desc;
