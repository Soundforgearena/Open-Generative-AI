-- CineX Premieres (coming soon): people who want to know when it opens.
create table if not exists public.premiere_waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  user_id uuid references auth.users(id) on delete set null,
  role text not null default 'viewer' check (role in ('viewer', 'creator')),
  created_at timestamptz not null default now()
);
create unique index if not exists premiere_waitlist_email_idx on public.premiere_waitlist (lower(email));
alter table public.premiere_waitlist enable row level security;
-- No policies: only the server (service role) reads or writes this table.
