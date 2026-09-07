-- Bind idempotency keys to their original quote and make Stripe reversal
-- transitions payment-aware, atomic, and retry-safe.

create or replace function public.reserve_credits_v2(
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
  v_row public.credit_reservations;
begin
  select * into v_existing
    from public.credit_reservations
   where user_id = p_user_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.operation is distinct from p_operation
       or v_existing.estimated_credits is distinct from p_estimated_credits
       or v_existing.max_reservation_credits is distinct from p_max_reservation_credits
       or v_existing.pricing_policy_version is distinct from p_pricing_policy_version
       or (v_existing.status <> 'reserved' and v_existing.generation_job_id is null) then
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
    from public.credit_wallets
   where user_id = p_user_id
   for update;
  if v_balance is null then
    raise exception 'No credit wallet for user';
  end if;
  if v_balance < p_max_reservation_credits then
    raise exception 'INSUFFICIENT_CREDITS';
  end if;

  update public.credit_wallets
     set balance = balance - p_max_reservation_credits,
         updated_at = now()
   where user_id = p_user_id;

  insert into public.credit_reservations(
    user_id, credits, operation, estimated_credits, max_reservation_credits,
    status, pricing_policy_version, idempotency_key, expires_at
  ) values (
    p_user_id, p_max_reservation_credits, p_operation, p_estimated_credits,
    p_max_reservation_credits, 'reserved', p_pricing_policy_version,
    p_idempotency_key, now() + make_interval(secs => p_ttl_seconds)
  ) returning * into v_row;

  insert into public.credit_ledger(user_id, amount, entry_type, reference_id, description)
  values (
    p_user_id, -p_max_reservation_credits, 'reservation', v_row.id::text,
    format('Reserved for %s', p_operation)
  );
  return v_row;
end;
$$;
revoke all on function public.reserve_credits_v2(uuid, text, integer, integer, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_credits_v2(uuid, text, integer, integer, text, text, integer)
  to service_role;

alter table public.payment_records
  add column if not exists refunded_credits integer not null default 0
    check (refunded_credits >= 0 and refunded_credits <= credits),
  add column if not exists disputed_credits integer not null default 0
    check (disputed_credits >= 0 and disputed_credits <= credits),
  add column if not exists refund_target_credits integer not null default 0
    check (refund_target_credits >= 0 and refund_target_credits <= credits),
  add column if not exists dispute_target_credits integer not null default 0
    check (dispute_target_credits >= 0 and dispute_target_credits <= credits),
  add column if not exists available_credits integer not null default 0
    check (available_credits >= 0 and available_credits <= credits);

alter table public.payment_records
  drop constraint if exists payment_records_reversal_exposure_check;
alter table public.payment_records
  add constraint payment_records_reversal_exposure_check
  check (
    refunded_credits + disputed_credits <= credits
    and refunded_credits <= refund_target_credits
    and disputed_credits <= dispute_target_credits
  );

alter table public.generation_requests
  add column if not exists provider_submission_started_at timestamptz,
  add column if not exists provider_cost_status text not null default 'pending'
    check (provider_cost_status in ('pending', 'recorded'));

create table if not exists public.reservation_credit_allocations (
  allocation_order bigint generated always as identity unique,
  reservation_id uuid not null references public.credit_reservations(id) on delete cascade,
  payment_record_id uuid not null references public.payment_records(id) on delete cascade,
  allocated_credits integer not null check (allocated_credits > 0),
  consumed_credits integer not null default 0 check (consumed_credits >= 0),
  released_credits integer not null default 0 check (released_credits >= 0),
  primary key (reservation_id, payment_record_id),
  check (consumed_credits + released_credits <= allocated_credits)
);
alter table public.reservation_credit_allocations enable row level security;

alter table public.refund_records
  add column if not exists stripe_event_id text;

alter table public.refund_records
  drop constraint if exists refund_records_stripe_dispute_id_key;
create unique index if not exists refund_records_stripe_event_id_idx
  on public.refund_records(stripe_event_id)
  where stripe_event_id is not null;
create unique index if not exists refund_records_dispute_transition_idx
  on public.refund_records(stripe_dispute_id, kind)
  where stripe_dispute_id is not null;

create or replace function public.apply_payment_reversal_targets(
  p_payment_record_id uuid,
  p_reason text default 'Deferred Stripe credit reversal'
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_payment public.payment_records;
  v_balance integer;
  v_refund_due integer;
  v_dispute_due integer;
  v_refund_apply integer;
  v_dispute_apply integer;
  v_total integer;
begin
  select * into v_payment
    from public.payment_records where id = p_payment_record_id for update;
  if not found then raise exception 'Payment not found'; end if;
  select balance into v_balance
    from public.credit_wallets where user_id = v_payment.user_id for update;
  if v_balance is null then raise exception 'Credit wallet not found'; end if;

  v_refund_due := greatest(0, v_payment.refund_target_credits - v_payment.refunded_credits);
  v_refund_apply := least(v_refund_due, v_payment.available_credits, v_balance);
  v_dispute_due := greatest(0, v_payment.dispute_target_credits - v_payment.disputed_credits);
  v_dispute_apply := least(
    v_dispute_due,
    greatest(0, v_payment.available_credits - v_refund_apply),
    greatest(0, v_balance - v_refund_apply)
  );
  v_total := v_refund_apply + v_dispute_apply;

  if v_total > 0 then
    update public.credit_wallets
       set balance = balance - v_total, updated_at = now()
     where user_id = v_payment.user_id;
    update public.payment_records
       set available_credits = available_credits - v_total,
           refunded_credits = refunded_credits + v_refund_apply,
           disputed_credits = disputed_credits + v_dispute_apply
     where id = v_payment.id;
    insert into public.credit_ledger(user_id, amount, entry_type, reference_id, description)
    values (v_payment.user_id, -v_total, 'refund', v_payment.id::text, p_reason);
  end if;
  return -v_total;
end;
$$;
revoke all on function public.apply_payment_reversal_targets(uuid, text)
  from public, anon, authenticated;
grant execute on function public.apply_payment_reversal_targets(uuid, text)
  to service_role;

create or replace function public.process_stripe_credit_reversal(
  p_event_id text,
  p_provider_payment_id text,
  p_kind text,
  p_external_id text,
  p_amount_cents integer,
  p_dispute_status text default null,
  p_reason text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_event public.stripe_events;
  v_payment public.payment_records;
  v_balance integer;
  v_target integer := 0;
  v_requested_delta integer := 0;
  v_applied_delta integer := 0;
begin
  if p_kind not in ('refund', 'dispute_created', 'dispute_closed') then
    raise exception 'Invalid Stripe reversal kind';
  end if;

  select * into v_event
    from public.stripe_events
   where event_id = p_event_id
   for update;
  if not found then
    raise exception 'Stripe event not claimed';
  end if;
  if v_event.status in ('processed', 'ignored') then
    return jsonb_build_object('duplicate', true);
  end if;
  if v_event.status <> 'processing' then
    raise exception 'Stripe event is not processing';
  end if;

  select * into v_payment
    from public.payment_records
   where provider_payment_id = p_provider_payment_id
   for update;
  if not found then
    update public.stripe_events
       set status = 'ignored', error_note = 'payment_not_found'
     where event_id = p_event_id;
    return jsonb_build_object('ignored', true);
  end if;

  select balance into v_balance
    from public.credit_wallets
   where user_id = v_payment.user_id
   for update;
  if v_balance is null then
    raise exception 'Credit wallet not found';
  end if;

  if p_kind = 'refund' then
    v_target := least(
      v_payment.credits,
      ceil(v_payment.credits::numeric * greatest(0, p_amount_cents) /
        greatest(1, v_payment.amount_cents))::integer
    );
    update public.payment_records
       set refund_target_credits = greatest(refund_target_credits, v_target),
           refunded_credits = least(
             greatest(refund_target_credits, v_target),
             refunded_credits + greatest(
               0,
               disputed_credits - least(
                 dispute_target_credits,
                 credits - greatest(refund_target_credits, v_target)
               )
             )
           ),
           disputed_credits = least(
             disputed_credits,
             least(
               dispute_target_credits,
               credits - greatest(refund_target_credits, v_target)
             )
           ),
           dispute_target_credits = least(
             dispute_target_credits,
             credits - greatest(refund_target_credits, v_target)
           ),
           status = case
             when greatest(0, p_amount_cents) >= amount_cents then 'refunded'
             else status
           end
     where id = v_payment.id
     returning * into v_payment;
    v_applied_delta := public.apply_payment_reversal_targets(v_payment.id, p_reason);
  elsif p_kind = 'dispute_created' then
    v_target := least(
      v_payment.credits,
      ceil(v_payment.credits::numeric * greatest(0, p_amount_cents) /
        greatest(1, v_payment.amount_cents))::integer
    );
    update public.payment_records
       set dispute_target_credits = least(
         greatest(dispute_target_credits, v_target),
         credits - refund_target_credits
       )
     where id = v_payment.id
     returning * into v_payment;
    v_applied_delta := public.apply_payment_reversal_targets(v_payment.id, p_reason);
  elsif p_dispute_status = 'won' then
    v_applied_delta := v_payment.disputed_credits;
    if v_applied_delta > 0 then
      update public.credit_wallets
         set balance = balance + v_applied_delta, updated_at = now()
       where user_id = v_payment.user_id;
      update public.payment_records
         set available_credits = available_credits + v_applied_delta,
             disputed_credits = 0,
             dispute_target_credits = 0
       where id = v_payment.id;
      insert into public.credit_ledger(user_id, amount, entry_type, reference_id, description)
      values (
        v_payment.user_id, v_applied_delta, 'adjustment', v_payment.id::text,
        coalesce(p_reason, 'Dispute hold restored')
      );
      v_applied_delta := v_applied_delta
        + public.apply_payment_reversal_targets(v_payment.id, 'Pending refund applied after dispute resolution');
    end if;
  else
    -- A lost/closed dispute keeps the original hold. It must not claw back a
    -- second time when Stripe sends the closing event.
    v_applied_delta := 0;
  end if;

  insert into public.refund_records(
    payment_record_id, stripe_refund_id, stripe_dispute_id, stripe_event_id,
    user_id, amount_cents, reason, kind, credits_clawed_back
  ) values (
    v_payment.id,
    case when p_kind = 'refund' then p_external_id else null end,
    case when p_kind like 'dispute_%' then p_external_id else null end,
    p_event_id,
    v_payment.user_id,
    greatest(0, p_amount_cents),
    p_reason,
    p_kind,
    greatest(0, -v_applied_delta)
  );

  if p_kind = 'dispute_created'
     or (p_kind = 'dispute_closed' and coalesce(p_dispute_status, '') <> 'won') then
    insert into public.financial_audit_events(user_id, event_type, details)
    values (
      v_payment.user_id,
      'account_flagged_chargeback',
      jsonb_build_object(
        'stripe_event_id', p_event_id,
        'external_id', p_external_id,
        'status', p_dispute_status,
        'note', p_reason
      )
    );
  end if;

  update public.stripe_events
     set status = 'processed', error_note = null
   where event_id = p_event_id;

  return jsonb_build_object(
    'payment_id', v_payment.id,
    'credit_delta', v_applied_delta,
    'kind', p_kind
  );
end;
$$;
revoke all on function public.process_stripe_credit_reversal(text, text, text, text, integer, text, text)
  from public, anon, authenticated;
grant execute on function public.process_stripe_credit_reversal(text, text, text, text, integer, text, text)
  to service_role;

-- New purchases create a refundable lot. Reservations consume promotional or
-- otherwise unattributed wallet credits first, then allocate paid lots FIFO.
drop function if exists public.fulfil_credit_purchase(
  uuid, integer, integer, integer, text, text
);
drop function if exists public.fulfil_credit_purchase(
  uuid, integer, integer, integer, text, text, text, integer, text
);
create or replace function public.fulfil_credit_purchase(
  p_user_id uuid,
  p_credits integer,
  p_amount_cents integer,
  p_fee_cents integer,
  p_provider text,
  p_provider_payment_id text,
  p_currency text,
  p_settled_amount_cents integer,
  p_settled_currency text
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
  select * into v_existing
    from public.payment_records
   where provider = p_provider and provider_payment_id = p_provider_payment_id;
  if found then
    return jsonb_build_object('status', 'already_fulfilled', 'credits', v_existing.credits);
  end if;
  if p_credits <= 0 or p_amount_cents <= 0 then
    raise exception 'Invalid purchase amount';
  end if;

  perform public.get_or_create_credit_wallet(p_user_id);
  select balance, net_cents_per_credit into v_old_balance, v_old_rate
    from public.credit_wallets where user_id = p_user_id for update;

  v_settled := coalesce(p_settled_amount_cents, p_amount_cents);
  v_net := greatest(v_settled - coalesce(p_fee_cents, 0), 0);
  v_new_rate := case
    when coalesce(v_old_balance, 0) + p_credits = 0 then 0
    else ((coalesce(v_old_balance, 0) * coalesce(v_old_rate, 0)) + v_net)
      / (coalesce(v_old_balance, 0) + p_credits)
  end;

  update public.credit_wallets
     set balance = balance + p_credits,
         lifetime_purchased = lifetime_purchased + p_credits,
         net_cents_per_credit = v_new_rate,
         updated_at = now()
   where user_id = p_user_id;

  insert into public.credit_ledger(user_id, amount, entry_type, reference_id, description)
  values (
    p_user_id, p_credits, 'purchase', p_provider_payment_id,
    format('Purchased %s credits', p_credits)
  );

  insert into public.payment_records(
    user_id, provider, provider_payment_id, amount_cents, credits, available_credits,
    status, currency, settled_amount_cents, settled_currency, fee_cents
  ) values (
    p_user_id, p_provider, p_provider_payment_id, p_amount_cents, p_credits, p_credits,
    'completed', lower(coalesce(p_currency, 'usd')), v_settled,
    lower(coalesce(p_settled_currency, p_currency, 'usd')), coalesce(p_fee_cents, 0)
  );

  return jsonb_build_object(
    'status', 'fulfilled', 'credits', p_credits, 'rate', v_new_rate, 'net', v_net
  );
end;
$$;
revoke all on function public.fulfil_credit_purchase(uuid, integer, integer, integer, text, text, text, integer, text)
  from public, anon, authenticated;
grant execute on function public.fulfil_credit_purchase(uuid, integer, integer, integer, text, text, text, integer, text)
  to service_role;

create or replace function public.fulfil_credit_purchase(
  p_user_id uuid,
  p_credits integer,
  p_amount_cents integer,
  p_fee_cents integer,
  p_provider text,
  p_provider_payment_id text
) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  return public.fulfil_credit_purchase(
    p_user_id, p_credits, p_amount_cents, p_fee_cents, p_provider,
    p_provider_payment_id, 'usd', p_amount_cents, 'usd'
  );
end;
$$;
revoke all on function public.fulfil_credit_purchase(uuid, integer, integer, integer, text, text)
  from public, anon, authenticated;
grant execute on function public.fulfil_credit_purchase(uuid, integer, integer, integer, text, text)
  to service_role;

create or replace function public.reserve_credits_v2(
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
  v_row public.credit_reservations;
  v_paid_available integer;
  v_unattributed_available integer;
  v_to_allocate integer;
  v_take integer;
  v_payment record;
begin
  select * into v_existing
    from public.credit_reservations
   where user_id = p_user_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.operation is distinct from p_operation
       or v_existing.estimated_credits is distinct from p_estimated_credits
       or v_existing.max_reservation_credits is distinct from p_max_reservation_credits
       or v_existing.pricing_policy_version is distinct from p_pricing_policy_version
       or (v_existing.status <> 'reserved' and v_existing.generation_job_id is null) then
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
  if v_balance < p_max_reservation_credits then raise exception 'INSUFFICIENT_CREDITS'; end if;

  perform 1
    from public.payment_records
   where user_id = p_user_id and status in ('completed', 'refunded') and available_credits > 0
   order by created_at, id
   for update;
  select coalesce(sum(available_credits), 0) into v_paid_available
    from public.payment_records
   where user_id = p_user_id and status in ('completed', 'refunded');
  v_unattributed_available := greatest(0, v_balance - v_paid_available);
  v_to_allocate := greatest(0, p_max_reservation_credits - v_unattributed_available);

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
    format('Reserved for %s', p_operation)
  );
  return v_row;
end;
$$;
revoke all on function public.reserve_credits_v2(uuid, text, integer, integer, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_credits_v2(uuid, text, integer, integer, text, text, integer)
  to service_role;

create or replace function public.settle_reservation_v2(
  p_reservation_id uuid,
  p_settled_credits integer,
  p_generation_job_id uuid default null
) returns public.credit_reservations
language plpgsql security definer set search_path = public as $$
declare
  v_row public.credit_reservations;
  v_release integer;
  v_allocated integer;
  v_unattributed_reserved integer;
  v_paid_to_consume integer;
  v_take integer;
  v_allocation record;
begin
  select * into v_row
    from public.credit_reservations where id = p_reservation_id for update;
  if not found then raise exception 'Reservation not found'; end if;
  if v_row.status <> 'reserved' then return v_row; end if;
  if p_settled_credits < 0 or p_settled_credits > v_row.max_reservation_credits then
    raise exception 'Settled credits out of range';
  end if;

  v_release := v_row.max_reservation_credits - p_settled_credits;
  select coalesce(sum(allocated_credits), 0) into v_allocated
    from public.reservation_credit_allocations
   where reservation_id = p_reservation_id;
  v_unattributed_reserved := v_row.max_reservation_credits - v_allocated;
  v_paid_to_consume := greatest(0, p_settled_credits - v_unattributed_reserved);

  update public.credit_wallets
     set balance = balance + v_release,
         lifetime_consumed = lifetime_consumed + p_settled_credits,
         updated_at = now()
   where user_id = v_row.user_id;

  for v_allocation in
    select reservation_id, payment_record_id, allocated_credits
      from public.reservation_credit_allocations
     where reservation_id = p_reservation_id
     order by allocation_order
     for update
  loop
    v_take := least(v_paid_to_consume, v_allocation.allocated_credits);
    update public.reservation_credit_allocations
       set consumed_credits = v_take,
           released_credits = v_allocation.allocated_credits - v_take
     where reservation_id = v_allocation.reservation_id
       and payment_record_id = v_allocation.payment_record_id;
    update public.payment_records
       set available_credits = available_credits + (v_allocation.allocated_credits - v_take)
     where id = v_allocation.payment_record_id;
    perform public.apply_payment_reversal_targets(
      v_allocation.payment_record_id,
      'Pending reversal applied when reservation settled'
    );
    v_paid_to_consume := v_paid_to_consume - v_take;
  end loop;

  update public.credit_reservations
     set status = 'settled', settled_credits = p_settled_credits,
         released_credits = v_release,
         generation_job_id = coalesce(p_generation_job_id, generation_job_id),
         updated_at = now()
   where id = p_reservation_id
   returning * into v_row;
  if v_release > 0 then
    insert into public.credit_ledger(user_id, amount, entry_type, reference_id, description)
    values (v_row.user_id, v_release, 'release', v_row.id::text, 'Unused reservation released');
  end if;
  insert into public.credit_ledger(user_id, amount, entry_type, reference_id, description)
  values (v_row.user_id, 0, 'consumption', v_row.id::text, 'Generation credits settled');
  return v_row;
end;
$$;
revoke all on function public.settle_reservation_v2(uuid, integer, uuid)
  from public, anon, authenticated;
grant execute on function public.settle_reservation_v2(uuid, integer, uuid)
  to service_role;

create or replace function public.release_reservation_v2(
  p_reservation_id uuid,
  p_reason text default 'provider_failed'
) returns public.credit_reservations
language plpgsql security definer set search_path = public as $$
declare
  v_row public.credit_reservations;
  v_allocation record;
begin
  select * into v_row
    from public.credit_reservations where id = p_reservation_id for update;
  if not found then raise exception 'Reservation not found'; end if;
  if v_row.status <> 'reserved' then return v_row; end if;

  update public.credit_wallets
     set balance = balance + v_row.max_reservation_credits, updated_at = now()
   where user_id = v_row.user_id;
  for v_allocation in
    select reservation_id, payment_record_id, allocated_credits
      from public.reservation_credit_allocations
     where reservation_id = p_reservation_id
     order by allocation_order
     for update
  loop
    update public.payment_records
       set available_credits = available_credits + v_allocation.allocated_credits
     where id = v_allocation.payment_record_id;
    update public.reservation_credit_allocations
       set released_credits = allocated_credits, consumed_credits = 0
     where reservation_id = v_allocation.reservation_id
       and payment_record_id = v_allocation.payment_record_id;
    perform public.apply_payment_reversal_targets(
      v_allocation.payment_record_id,
      'Pending reversal applied when reservation released'
    );
  end loop;
  update public.credit_reservations
     set status = 'released', released_credits = v_row.max_reservation_credits, updated_at = now()
   where id = p_reservation_id
   returning * into v_row;
  insert into public.credit_ledger(user_id, amount, entry_type, reference_id, description)
  values (
    v_row.user_id, v_row.max_reservation_credits, 'release', v_row.id::text,
    format('Reservation released: %s', p_reason)
  );
  return v_row;
end;
$$;
revoke all on function public.release_reservation_v2(uuid, text)
  from public, anon, authenticated;
grant execute on function public.release_reservation_v2(uuid, text)
  to service_role;

create unique index if not exists provider_cost_records_generation_job_idx
  on public.provider_cost_records(generation_job_id)
  where generation_job_id is not null;

create or replace function public.record_provider_cost_once(
  p_reservation_id uuid,
  p_generation_job_id uuid,
  p_provider text,
  p_provider_request_id text,
  p_actual_cost_cents integer,
  p_raw_response jsonb
) returns public.provider_cost_records
language plpgsql security definer set search_path = public as $$
declare
  v_row public.provider_cost_records;
begin
  insert into public.provider_cost_records(
    reservation_id, generation_job_id, provider, provider_request_id,
    actual_cost_cents, raw_response
  ) values (
    p_reservation_id, p_generation_job_id, p_provider, p_provider_request_id,
    p_actual_cost_cents, p_raw_response
  )
  on conflict (generation_job_id) where generation_job_id is not null
  do update set
    provider_request_id = coalesce(excluded.provider_request_id, public.provider_cost_records.provider_request_id),
    actual_cost_cents = excluded.actual_cost_cents,
    raw_response = excluded.raw_response
  returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.record_provider_cost_once(uuid, uuid, text, text, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_provider_cost_once(uuid, uuid, text, text, integer, jsonb)
  to service_role;

create unique index if not exists generation_requests_provider_request_unique_idx
  on public.generation_requests(provider_request_id)
  where provider_request_id is not null;

create or replace function public.mark_generation_started(
  p_generation_job_id uuid,
  p_provider_request_id text
) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update public.generation_requests
     set provider_request_id = p_provider_request_id, status = 'running', updated_at = now()
   where id = p_generation_job_id and status in ('queued', 'running');
  return found;
end;
$$;
revoke all on function public.mark_generation_started(uuid, text)
  from public, anon, authenticated;
grant execute on function public.mark_generation_started(uuid, text)
  to service_role;
