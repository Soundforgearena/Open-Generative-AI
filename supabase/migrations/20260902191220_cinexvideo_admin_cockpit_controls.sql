-- Applied to production as version 20260902191220 (cinexvideo_admin_cockpit_controls).
-- Content exported verbatim from supabase_migrations.schema_migrations.

create table if not exists public.admin_metric_events (id uuid primary key default gen_random_uuid(), event_type text not null, operation text, model text, user_id uuid references auth.users(id) on delete set null, generation_job_id uuid, provider_cost_cents numeric(12,4) default 0, customer_revenue_cents numeric(12,4) default 0, credits integer default 0, duration_ms integer, status text, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now());
create table if not exists public.admin_health_snapshots (id uuid primary key default gen_random_uuid(), service text not null, status text not null check (status in ('operational','degraded','outage','unknown')), latency_ms integer, error_rate numeric(7,4), metadata jsonb not null default '{}'::jsonb, checked_at timestamptz not null default now());
create table if not exists public.app_settings (key text primary key, value jsonb not null default '{}'::jsonb, updated_at timestamptz not null default now(), updated_by uuid references auth.users(id) on delete set null);
create table if not exists public.user_admin_actions (id uuid primary key default gen_random_uuid(), admin_user_id uuid references auth.users(id) on delete set null, target_user_id uuid references auth.users(id) on delete set null, action text not null check (action in ('add_user','remove_user','grant_bonus','toggle_discount','toggle_maintenance')), credits integer, note text, created_at timestamptz not null default now());
create index if not exists admin_metric_events_created_at_idx on public.admin_metric_events(created_at desc);
create index if not exists admin_metric_events_type_idx on public.admin_metric_events(event_type, created_at desc);
create index if not exists admin_health_snapshots_checked_at_idx on public.admin_health_snapshots(checked_at desc);
create index if not exists user_admin_actions_created_at_idx on public.user_admin_actions(created_at desc);
alter table public.admin_metric_events enable row level security;
alter table public.admin_health_snapshots enable row level security;
alter table public.app_settings enable row level security;
alter table public.user_admin_actions enable row level security;
insert into public.app_settings(key,value) values ('maintenance_mode','{"enabled":false,"message":"CinexVideo is undergoing scheduled maintenance. Please check back soon."}'::jsonb), ('discount_mode','{"enabled":false,"percent":0,"label":""}'::jsonb) on conflict (key) do nothing;
create or replace view public.admin_cockpit_summary as select count(*) filter (where created_at >= now() - interval '24 hours') as events_24h, count(*) filter (where event_type='generation' and created_at >= now() - interval '24 hours') as generations_24h, coalesce(sum(customer_revenue_cents) filter (where created_at >= now() - interval '24 hours'),0) as revenue_24h_cents, coalesce(sum(provider_cost_cents) filter (where created_at >= now() - interval '24 hours'),0) as provider_cost_24h_cents, coalesce(sum(credits) filter (where created_at >= now() - interval '24 hours'),0) as credits_24h, count(*) filter (where status='failed' and created_at >= now() - interval '24 hours') as failures_24h from public.admin_metric_events;
revoke all on public.admin_cockpit_summary from public;
