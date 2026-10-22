-- Applied to production as version 20260903163606 (cinexvideo_fix_payment_status).
-- Content exported verbatim from supabase_migrations.schema_migrations.

-- payment_records.status CHECK allows only pending/completed/failed/refunded.
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

  insert into public.payment_records(user_id, provider, provider_payment_id, amount_cents, credits, status)
  values (p_user_id, p_provider, p_provider_payment_id, p_amount_cents, p_credits, 'completed');

  return jsonb_build_object('status','fulfilled','credits',p_credits,'rate',v_new_rate);
end;
$$;

revoke all on function public.fulfil_credit_purchase(uuid, integer, integer, integer, text, text) from public, anon, authenticated;
