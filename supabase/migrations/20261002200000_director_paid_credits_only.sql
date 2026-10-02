-- AI Director usage may only be paid for with purchased credits.
-- Sign-up and admin bonus credits (wallet balance with no payment record
-- behind it) cannot be spent here. Every reserved credit is allocated to a
-- completed payment so settle/release keep payment_records accurate.
create or replace function public.reserve_paid_credits_v1(
  p_user_id uuid,
  p_operation text,
  p_estimated_credits integer,
  p_max_reservation_credits integer,
  p_pricing_policy_version text,
  p_idempotency_key text,
  p_ttl_seconds integer default 900
) returns public.credit_reservations
language plpgsql security definer set search_path = public as $$
declare
  v_existing public.credit_reservations;
  v_balance integer;
  v_paid_available integer;
  v_to_allocate integer;
  v_take integer;
  v_payment record;
  v_row public.credit_reservations;
begin
  select * into v_existing
    from public.credit_reservations
   where user_id = p_user_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.operation is distinct from p_operation
       or v_existing.max_reservation_credits is distinct from p_max_reservation_credits
       or v_existing.pricing_policy_version is distinct from p_pricing_policy_version
       or v_existing.status <> 'reserved' then
      raise exception 'IDEMPOTENCY_KEY_CONFLICT';
    end if;
    return v_existing;
  end if;
  if p_max_reservation_credits <= 0
     or p_estimated_credits < 0
     or p_max_reservation_credits < p_estimated_credits then
    raise exception 'Invalid reservation amount';
  end if;

  select balance into v_balance
    from public.credit_wallets where user_id = p_user_id for update;
  if v_balance is null then raise exception 'No credit wallet for user'; end if;

  perform 1
    from public.payment_records
   where user_id = p_user_id and status in ('completed', 'refunded') and available_credits > 0
   order by created_at, id
   for update;
  select coalesce(sum(available_credits), 0) into v_paid_available
    from public.payment_records
   where user_id = p_user_id and status in ('completed', 'refunded');

  if least(v_balance, v_paid_available) < p_max_reservation_credits then
    raise exception 'INSUFFICIENT_PAID_CREDITS';
  end if;

  update public.credit_wallets
     set balance = balance - p_max_reservation_credits, updated_at = now()
   where user_id = p_user_id;
  insert into public.credit_reservations(
    user_id, credits, operation, estimated_credits, max_reservation_credits,
    status, pricing_policy_version, idempotency_key, expires_at
  ) values (
    p_user_id, p_max_reservation_credits, p_operation, p_estimated_credits,
    p_max_reservation_credits, 'reserved', p_pricing_policy_version,
    p_idempotency_key, now() + make_interval(secs => p_ttl_seconds)
  ) returning * into v_row;

  v_to_allocate := p_max_reservation_credits;
  for v_payment in
    select id, available_credits
      from public.payment_records
     where user_id = p_user_id and status in ('completed', 'refunded') and available_credits > 0
     order by created_at, id
     for update
  loop
    exit when v_to_allocate <= 0;
    v_take := least(v_to_allocate, v_payment.available_credits);
    update public.payment_records
       set available_credits = available_credits - v_take
     where id = v_payment.id;
    insert into public.reservation_credit_allocations(
      reservation_id, payment_record_id, allocated_credits
    ) values (v_row.id, v_payment.id, v_take);
    v_to_allocate := v_to_allocate - v_take;
  end loop;
  if v_to_allocate <> 0 then raise exception 'Paid credit allocation mismatch'; end if;

  insert into public.credit_ledger(user_id, amount, entry_type, reference_id, description)
  values (
    p_user_id, -p_max_reservation_credits, 'reservation', v_row.id::text,
    format('Reserved purchased credits for %s', p_operation)
  );
  return v_row;
end;
$$;

revoke all on function public.reserve_paid_credits_v1(uuid, text, integer, integer, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_paid_credits_v1(uuid, text, integer, integer, text, text, integer)
  to service_role;

-- Read-only helper so the app can show how many purchased credits remain.
create or replace function public.paid_credits_available(p_user_id uuid)
returns integer
language sql stable security definer set search_path = public as $$
  select least(
    coalesce((select balance from public.credit_wallets where user_id = p_user_id), 0),
    coalesce((select sum(available_credits) from public.payment_records
               where user_id = p_user_id and status in ('completed', 'refunded')), 0)
  )::integer;
$$;
revoke all on function public.paid_credits_available(uuid) from public, anon, authenticated;
grant execute on function public.paid_credits_available(uuid) to service_role;
