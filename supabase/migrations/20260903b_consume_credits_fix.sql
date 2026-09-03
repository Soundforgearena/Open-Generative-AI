-- credit_ledger.entry_type only accepts: grant|purchase|reservation|release|consumption|refund|adjustment
-- reserve_credits() already debits the balance, so consumption is a zero-value
-- settlement entry that closes out the reservation in the audit trail.
create or replace function public.consume_credits(
  p_user_id uuid, p_credits integer, p_reference_id text
) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if p_credits <= 0 then return false; end if;
  update public.credit_wallets
     set lifetime_consumed = lifetime_consumed + p_credits, updated_at = now()
   where user_id = p_user_id;
  insert into public.credit_ledger(user_id, amount, entry_type, reference_id, description)
  values (p_user_id, 0, 'consumption', p_reference_id, 'Generation credits consumed');
  return true;
end;
$$;

revoke all on function public.consume_credits(uuid, integer, text) from public, anon, authenticated;
