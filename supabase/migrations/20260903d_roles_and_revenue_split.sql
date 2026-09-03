-- Admin roles (super_admin / admin), email-based admin invites, revenue
-- partners, the revenue event ledger, partner earnings and payouts.
-- Applied to project xmdgszvkhzgpketayzns on 2026-09-03.
-- Full statements are reproduced here so the schema is reproducible from the repo.

alter table public.admin_members add column if not exists role text not null default 'admin';
alter table public.admin_members drop constraint if exists admin_members_role_check;
alter table public.admin_members add constraint admin_members_role_check check (role in ('super_admin','admin'));

create or replace function public.is_cinex_super_admin(p_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.admin_members where user_id = p_user_id and role = 'super_admin');
$$;

create table if not exists public.admin_invites (
  email text primary key,
  role text not null default 'admin' check (role in ('super_admin','admin')),
  note text,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  claimed_by uuid references auth.users(id) on delete set null
);
alter table public.admin_invites enable row level security;
drop policy if exists admin_invites_super on public.admin_invites;
create policy admin_invites_super on public.admin_invites
  for all using (public.is_cinex_super_admin(auth.uid()))
  with check (public.is_cinex_super_admin(auth.uid()));

insert into public.admin_invites(email, role, note) values
  ('beatkitbuilder@gmail.com','super_admin','Platform owner'),
  ('kingbeatexclusives@gmail.com','admin','Operations admin')
on conflict (email) do update set role = excluded.role, note = excluded.note;

create table if not exists public.revenue_partners (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  display_name text not null,
  user_id uuid references auth.users(id) on delete set null,
  share_percent numeric(5,2) not null check (share_percent >= 0 and share_percent <= 100),
  active boolean not null default true,
  payout_provider text not null default 'manual' check (payout_provider in ('manual','stripe_express','paypal')),
  stripe_account_id text,
  payouts_enabled boolean not null default false,
  onboarding_status text not null default 'not_started',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.revenue_partners(email, display_name, share_percent, active) values
  ('beatkitbuilder@gmail.com','BeatKitBuilder', 70.00, true),
  ('kingbeatexclusives@gmail.com','King Beat Exclusives', 30.00, true)
on conflict (email) do update set share_percent = excluded.share_percent, display_name = excluded.display_name;

create table if not exists public.revenue_events (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  reference_id text,
  user_id uuid references auth.users(id) on delete set null,
  gross_cents integer not null default 0,
  provider_cost_cents integer not null default 0,
  overhead_cents integer not null default 0,
  payment_fee_cents integer not null default 0,
  net_cents integer not null default 0,
  basis text not null default 'net' check (basis in ('net','gross')),
  base_cents integer not null default 0,
  platform_percent numeric(5,2) not null,
  platform_cents integer not null default 0,
  distributed_cents integer not null default 0,
  created_at timestamptz not null default now(),
  unique (source, reference_id)
);

create table if not exists public.partner_earnings (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.revenue_partners(id) on delete cascade,
  revenue_event_id uuid not null references public.revenue_events(id) on delete cascade,
  share_percent numeric(5,2) not null,
  amount_cents integer not null,
  payout_id uuid,
  created_at timestamptz not null default now(),
  unique (partner_id, revenue_event_id)
);

create table if not exists public.partner_payouts (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.revenue_partners(id) on delete cascade,
  amount_cents integer not null check (amount_cents > 0),
  provider text not null default 'manual',
  provider_transfer_id text,
  status text not null default 'pending' check (status in ('pending','paid','failed','cancelled')),
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.revenue_partners enable row level security;
alter table public.revenue_events enable row level security;
alter table public.partner_earnings enable row level security;
alter table public.partner_payouts enable row level security;

insert into public.app_settings(key, value) values
  ('revenue_split', '{"platform_percent": 50, "basis": "net"}'::jsonb)
on conflict (key) do nothing;
