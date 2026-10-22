-- Applied to production as version 20261007021724 (premieres_waitlist).
-- Content exported verbatim from supabase_migrations.schema_migrations.

create table if not exists public.premiere_waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  user_id uuid references auth.users(id) on delete set null,
  role text not null default 'viewer' check (role in ('viewer', 'creator')),
  created_at timestamptz not null default now()
);
create unique index if not exists premiere_waitlist_email_idx on public.premiere_waitlist (lower(email));
alter table public.premiere_waitlist enable row level security;
