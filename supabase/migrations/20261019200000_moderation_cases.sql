-- Moderation review queue. Server-only: RLS on with no policies, so only the
-- service role (API routes) can read or write it. The super-admin page reads
-- it through /api/admin/moderation.
create table if not exists public.moderation_cases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  project_id uuid,
  scene_id uuid,
  kind text not null check (kind in ('prompt', 'photo', 'still', 'take', 'director')),
  where_checked text,
  categories text[] not null default '{}',
  scores jsonb not null default '{}'::jsonb,
  severe boolean not null default false,
  account_suspended boolean not null default false,
  prompt_excerpt text,
  media_ref text,
  media_sha256 text,
  media_bytes bigint,
  status text not null default 'open' check (status in ('open', 'confirmed', 'false_positive', 'reported')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists moderation_cases_status_idx on public.moderation_cases (status, created_at desc);
create index if not exists moderation_cases_user_idx on public.moderation_cases (user_id, created_at desc);

alter table public.moderation_cases enable row level security;
revoke all on public.moderation_cases from anon, authenticated;
