-- Apply this additive migration BEFORE deploying runDirectorOnce.
create table if not exists public.director_requests (
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key text not null check (length(idempotency_key) between 1 and 200),
  fingerprint text not null,
  status text not null default 'processing' check (status in ('processing', 'completed')),
  response_status integer check (response_status between 200 and 599),
  response_body jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, idempotency_key),
  constraint director_completed_response check (
    status <> 'completed' or (response_status is not null and response_body is not null)
  )
);
alter table public.director_requests enable row level security;
revoke all on public.director_requests from public, anon, authenticated;
grant select, insert, update on public.director_requests to service_role;
create index if not exists director_requests_processing_age_idx
  on public.director_requests(created_at) where status = 'processing';

-- Pin search paths identified by the Supabase security advisor.
alter function public.touch_updated_at() set search_path = public;
alter function public.cinex_normalize_email(text) set search_path = public;
alter function public.calculate_customer_price(numeric, numeric) set search_path = public;
alter function public.calculate_customer_price(numeric, numeric, numeric, numeric, numeric, numeric, numeric) set search_path = public;
