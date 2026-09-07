-- Prepaid credit safety: idempotent Stripe events, reservations, provider cost,
-- and fee/audit tables. Safely upgrades the legacy reservation table and
-- narrows execution privileges on server-only wallet functions.

-- --------------------------------------------------------- stripe_events
-- Records every verified webhook delivery by Stripe event ID so retried
-- deliveries (which Stripe performs automatically) can never be re-applied.
create table if not exists public.stripe_events (
  event_id text primary key,
  event_type text not null,
  payload jsonb not null,
  status text not null default 'processing' check (status in ('processing','processed','failed','ignored')),
  error_note text,
  processing_started_at timestamptz,
  received_at timestamptz not null default now()
);
alter table public.stripe_events enable row level security;
-- Service role only; no policy is created so no anon/authenticated role can
-- select, insert, update, or delete without SUPABASE_SERVICE_ROLE_KEY (RLS
-- default-denies when a table has RLS enabled and no matching policy).

-- ---------------------------------------------------- credit_reservations
-- Upgrade both a blank database and the legacy seven-column table already
-- present in production.
create table if not exists public.credit_reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  generation_job_id uuid,
  credits integer not null check (credits > 0),
  operation text,
  estimated_credits integer,
  max_reservation_credits integer,
  settled_credits integer,
  released_credits integer,
  status text not null default 'reserved',
  pricing_policy_version text,
  idempotency_key text,
  expires_at timestamptz not null default (now() + interval '2 hours'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.credit_reservations
  add column if not exists operation text,
  add column if not exists estimated_credits integer,
  add column if not exists max_reservation_credits integer,
  add column if not exists settled_credits integer,
  add column if not exists released_credits integer,
  add column if not exists pricing_policy_version text,
  add column if not exists idempotency_key text,
  add column if not exists updated_at timestamptz default now();

update public.credit_reservations
set operation = coalesce(operation, 'legacy'),
    estimated_credits = coalesce(estimated_credits, credits),
    max_reservation_credits = coalesce(max_reservation_credits, credits),
    pricing_policy_version = coalesce(pricing_policy_version, 'legacy'),
    idempotency_key = coalesce(idempotency_key, 'legacy:' || id::text),
    updated_at = coalesce(updated_at, created_at, now());

alter table public.credit_reservations
  alter column updated_at set default now(),
  alter column updated_at set not null;

alter table public.credit_reservations drop constraint if exists credit_reservations_status_check;
alter table public.credit_reservations
  add constraint credit_reservations_status_check
  check (status in ('reserved','settled','released','consumed','expired'));
alter table public.credit_reservations drop constraint if exists credit_reservations_estimated_credits_check;
alter table public.credit_reservations
  add constraint credit_reservations_estimated_credits_check check (estimated_credits >= 0);
alter table public.credit_reservations drop constraint if exists credit_reservations_max_reservation_credits_check;
alter table public.credit_reservations
  add constraint credit_reservations_max_reservation_credits_check
  check (max_reservation_credits >= estimated_credits);

create index if not exists credit_reservations_user_idx on public.credit_reservations(user_id, created_at desc);
create index if not exists credit_reservations_job_idx on public.credit_reservations(generation_job_id);
create unique index if not exists credit_reservations_user_idempotency_idx
  on public.credit_reservations(user_id, idempotency_key);

alter table public.credit_reservations enable row level security;
drop policy if exists credit_reservations_owner_select on public.credit_reservations;
create policy credit_reservations_owner_select on public.credit_reservations
  for select using (user_id = auth.uid() or public.is_cinex_admin(auth.uid()));
-- Insert/update/delete intentionally has no policy: only the service role
-- (server routes) may mutate reservations, never the browser directly.

-- Link the existing generation table to the same client idempotency key. The
-- partial unique index preserves existing rows created by the legacy route.
alter table public.generation_requests add column if not exists idempotency_key text;
create unique index if not exists generation_requests_user_idempotency_idx
  on public.generation_requests(user_id, idempotency_key)
  where idempotency_key is not null;

-- ---------------------------------------------------- provider_cost_records
-- Actual MuAPI cost per completed/failed job, used for real settlement and
-- margin verification instead of the estimate alone.
create table if not exists public.provider_cost_records (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid references public.credit_reservations(id) on delete set null,
  generation_job_id uuid,
  provider text not null default 'muapi',
  provider_request_id text,
  actual_cost_cents integer not null check (actual_cost_cents >= 0),
  currency text not null default 'usd',
  raw_response jsonb,
  recorded_at timestamptz not null default now()
);
create index if not exists provider_cost_records_reservation_idx on public.provider_cost_records(reservation_id);
alter table public.provider_cost_records enable row level security;
-- Service role only; no anon/authenticated policy.

-- --------------------------------------------------------- payment_fee_records
-- Stripe processing fees per payment, for true net-margin reporting.
create table if not exists public.payment_fee_records (
  id uuid primary key default gen_random_uuid(),
  payment_record_id uuid references public.payment_records(id) on delete cascade,
  stripe_balance_transaction_id text unique,
  fee_cents integer not null check (fee_cents >= 0),
  net_cents integer not null,
  currency text not null default 'usd',
  recorded_at timestamptz not null default now()
);
alter table public.payment_fee_records enable row level security;
-- Service role only; no anon/authenticated policy.

-- --------------------------------------------------------- refund_records
create table if not exists public.refund_records (
  id uuid primary key default gen_random_uuid(),
  payment_record_id uuid references public.payment_records(id) on delete cascade,
  stripe_refund_id text unique,
  stripe_dispute_id text unique,
  user_id uuid references auth.users(id) on delete set null,
  amount_cents integer not null check (amount_cents >= 0),
  reason text,
  kind text not null check (kind in ('refund','dispute_created','dispute_closed')),
  credits_clawed_back integer not null default 0,
  created_at timestamptz not null default now()
);
alter table public.refund_records enable row level security;
-- Service role only; no anon/authenticated policy.

-- ------------------------------------------------------- financial_audit_events
-- Append-only trail for every server-side money/credit decision (reserve,
-- settle, release, block, override) independent of the ledger, so the admin
-- cockpit and support tooling can reconstruct exactly why a decision was made.
create table if not exists public.financial_audit_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  reservation_id uuid references public.credit_reservations(id) on delete set null,
  event_type text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists financial_audit_events_user_idx on public.financial_audit_events(user_id, created_at desc);
alter table public.financial_audit_events enable row level security;
-- Service role only; no anon/authenticated policy.

-- ------------------------------------------------------------- reserve_credits_v2
-- Atomically checks and debits available balance, and writes the reservation
-- row in the same transaction so a concurrent request can never overspend.
-- Idempotent on idempotency_key: a retried call returns the existing row
-- rather than reserving twice.
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
    return v_existing;
  end if;

  if p_max_reservation_credits <= 0 then
    raise exception 'max_reservation_credits must be positive';
  end if;

  -- Row lock prevents a second concurrent reservation from reading a stale balance.
  select balance into v_balance from public.credit_wallets where user_id = p_user_id for update;
  if v_balance is null then
    raise exception 'No credit wallet for user';
  end if;
  if v_balance < p_max_reservation_credits then
    raise exception 'INSUFFICIENT_CREDITS';
  end if;

  update public.credit_wallets set balance = balance - p_max_reservation_credits, updated_at = now()
   where user_id = p_user_id;

  insert into public.credit_reservations(
    user_id, credits, operation, estimated_credits, max_reservation_credits,
    status, pricing_policy_version, idempotency_key, expires_at
  ) values (
    p_user_id, p_max_reservation_credits, p_operation, p_estimated_credits, p_max_reservation_credits,
    'reserved', p_pricing_policy_version, p_idempotency_key, now() + make_interval(secs => p_ttl_seconds)
  ) returning * into v_row;

  insert into public.credit_ledger(user_id, amount, entry_type, reference_id, description)
  values (p_user_id, -p_max_reservation_credits, 'reservation', v_row.id::text, format('Reserved for %s', p_operation));

  return v_row;
end;
$$;
revoke all on function public.reserve_credits_v2(uuid, text, integer, integer, text, text, integer) from public, anon, authenticated;
grant execute on function public.reserve_credits_v2(uuid, text, integer, integer, text, text, integer) to service_role;

-- ------------------------------------------------------------- settle_reservation_v2
-- Releases the unused portion of a reservation back to the wallet balance and
-- marks it settled. Refuses to settle more than was reserved.
create or replace function public.settle_reservation_v2(
  p_reservation_id uuid,
  p_settled_credits integer,
  p_generation_job_id uuid default null
) returns public.credit_reservations
language plpgsql security definer set search_path = public as $$
declare
  v_row public.credit_reservations;
  v_release integer;
begin
  select * into v_row from public.credit_reservations where id = p_reservation_id for update;
  if not found then
    raise exception 'Reservation not found';
  end if;
  if v_row.status <> 'reserved' then
    return v_row; -- already settled/released: idempotent no-op
  end if;
  if p_settled_credits < 0 or p_settled_credits > v_row.max_reservation_credits then
    raise exception 'Settled credits out of range';
  end if;

  v_release := v_row.max_reservation_credits - p_settled_credits;

  update public.credit_wallets
     set balance = balance + v_release,
         lifetime_consumed = lifetime_consumed + p_settled_credits,
         updated_at = now()
   where user_id = v_row.user_id;

  update public.credit_reservations
     set status = 'settled', settled_credits = p_settled_credits, released_credits = v_release,
         generation_job_id = coalesce(p_generation_job_id, generation_job_id), updated_at = now()
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
revoke all on function public.settle_reservation_v2(uuid, integer, uuid) from public, anon, authenticated;
grant execute on function public.settle_reservation_v2(uuid, integer, uuid) to service_role;

-- ------------------------------------------------------------- release_reservation_v2
-- Full refund of a reservation (job never ran / failed before any provider cost).
create or replace function public.release_reservation_v2(
  p_reservation_id uuid,
  p_reason text default 'provider_failed'
) returns public.credit_reservations
language plpgsql security definer set search_path = public as $$
declare
  v_row public.credit_reservations;
begin
  select * into v_row from public.credit_reservations where id = p_reservation_id for update;
  if not found then
    raise exception 'Reservation not found';
  end if;
  if v_row.status <> 'reserved' then
    return v_row; -- idempotent no-op
  end if;

  update public.credit_wallets set balance = balance + v_row.max_reservation_credits, updated_at = now()
   where user_id = v_row.user_id;

  update public.credit_reservations
     set status = 'released', released_credits = v_row.max_reservation_credits, updated_at = now()
   where id = p_reservation_id
   returning * into v_row;

  insert into public.credit_ledger(user_id, amount, entry_type, reference_id, description)
  values (v_row.user_id, v_row.max_reservation_credits, 'release', v_row.id::text, format('Reservation released: %s', p_reason));

  return v_row;
end;
$$;
revoke all on function public.release_reservation_v2(uuid, text) from public, anon, authenticated;
grant execute on function public.release_reservation_v2(uuid, text) to service_role;

-- ------------------------------------------------------------- wallet adjustment
-- Refund/dispute adjustments are service-only and record the actual applied
-- delta atomically. A clawback never violates the wallet's non-negative check.
create or replace function public.adjust_credit_wallet(
  p_user_id uuid,
  p_credit_delta integer,
  p_reason text,
  p_reference_id text default null
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_balance integer;
  v_applied integer;
begin
  select balance into v_balance
    from public.credit_wallets
   where user_id = p_user_id
   for update;
  if v_balance is null then
    raise exception 'Credit wallet not found';
  end if;

  v_applied := greatest(p_credit_delta, -v_balance);
  update public.credit_wallets
     set balance = balance + v_applied,
         updated_at = now()
   where user_id = p_user_id;

  insert into public.credit_ledger(user_id, amount, entry_type, reference_id, description)
  values (
    p_user_id,
    v_applied,
    case when v_applied < 0 then 'refund' else 'adjustment' end,
    p_reference_id,
    p_reason
  );
  return v_applied;
end;
$$;
revoke all on function public.adjust_credit_wallet(uuid, integer, text, text) from public, anon, authenticated;
grant execute on function public.adjust_credit_wallet(uuid, integer, text, text) to service_role;

-- Legacy wallet mutation functions must never be callable from PostgREST by
-- anonymous or ordinary authenticated users.
revoke execute on function public.get_or_create_credit_wallet(uuid) from public, anon, authenticated;
revoke execute on function public.reserve_credits(uuid, integer, text) from public, anon, authenticated;
revoke execute on function public.release_credits(uuid, integer, text) from public, anon, authenticated;
grant execute on function public.get_or_create_credit_wallet(uuid) to service_role;
grant execute on function public.reserve_credits(uuid, integer, text) to service_role;
grant execute on function public.release_credits(uuid, integer, text) to service_role;
