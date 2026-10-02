-- Super admins run on platform funds: the business pays OpenAI and MUAPI
-- directly, so their usage never debits a credit wallet. Every platform-funded
-- action is still recorded here so the real cost stays visible.

alter table public.generation_requests
  add column if not exists funding_source text not null default 'credits';
alter table public.generation_requests
  drop constraint if exists generation_requests_funding_source_check;
alter table public.generation_requests
  add constraint generation_requests_funding_source_check
  check (funding_source in ('credits', 'platform'));

create table if not exists public.platform_funded_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  operation text not null,
  provider text not null,
  model text,
  generation_job_id uuid references public.generation_requests(id) on delete set null,
  estimated_cost_cents numeric(12, 4) not null default 0 check (estimated_cost_cents >= 0),
  credits_equivalent integer not null default 0 check (credits_equivalent >= 0),
  created_at timestamptz not null default now()
);
create index if not exists platform_funded_usage_created_idx
  on public.platform_funded_usage(created_at desc);
create index if not exists platform_funded_usage_user_created_idx
  on public.platform_funded_usage(user_id, created_at desc);

alter table public.platform_funded_usage enable row level security;
revoke all on public.platform_funded_usage from public, anon, authenticated;
grant select, insert, update on public.platform_funded_usage to service_role;
