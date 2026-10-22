-- Applied to production as version 20260902185649 (cinexvideo_paywall_credit_model).
-- Content exported verbatim from supabase_migrations.schema_migrations.

-- CinexVideo paywall and credit model migration
-- Creates plans, wallets, ledger, model pricing, reservations, and payment records.
-- All monetary values are stored in USD cents; margin target is 45%.
create extension if not exists pgcrypto;

create table if not exists public.billing_plans (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  monthly_price_cents integer not null check (monthly_price_cents >= 0),
  included_credits integer not null check (included_credits >= 0),
  overage_price_cents integer not null check (overage_price_cents >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.credit_wallets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  balance integer not null default 0 check (balance >= 0),
  lifetime_purchased integer not null default 0,
  lifetime_consumed integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  amount integer not null,
  entry_type text not null check (entry_type in ('grant','purchase','reservation','release','consumption','refund','adjustment')),
  reference_id text,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists public.model_cost_rules (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'muapi',
  model text not null,
  operation text not null check (operation in ('image','video','audio','edit','upscale','watermark')),
  provider_cost_cents numeric(12,4) not null check (provider_cost_cents >= 0),
  target_margin_percent numeric(5,2) not null default 45 check (target_margin_percent between 0 and 99.99),
  customer_price_cents numeric(12,4) generated always as (provider_cost_cents / (1 - target_margin_percent / 100.0)) stored,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(provider, model, operation)
);

create table if not exists public.credit_reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  generation_job_id uuid,
  credits integer not null check (credits > 0),
  status text not null default 'reserved' check (status in ('reserved','consumed','released','expired')),
  expires_at timestamptz not null default (now() + interval '2 hours'),
  created_at timestamptz not null default now()
);

create table if not exists public.payment_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  provider_payment_id text unique,
  amount_cents integer not null check (amount_cents >= 0),
  credits integer not null check (credits >= 0),
  status text not null check (status in ('pending','completed','failed','refunded')),
  created_at timestamptz not null default now()
);

insert into public.billing_plans (code,name,monthly_price_cents,included_credits,overage_price_cents)
values
 ('free','Free',0,20,0),
 ('creator','Creator',1900,300,8),
 ('studio','Studio',4900,1000,6),
 ('pro','Pro',9900,2500,5)
on conflict (code) do update set name=excluded.name, monthly_price_cents=excluded.monthly_price_cents, included_credits=excluded.included_credits, overage_price_cents=excluded.overage_price_cents;

insert into public.model_cost_rules (provider,model,operation,provider_cost_cents,target_margin_percent)
values
 ('muapi','flux.1-schnell','image',0.3,45),
 ('muapi','pixverse-v6','video',3.3,45),
 ('muapi','wan-video','video',20,45),
 ('muapi','video-editing-basic','edit',20,45),
 ('muapi','watermark','watermark',0,45)
on conflict (provider,model,operation) do update set provider_cost_cents=excluded.provider_cost_cents, target_margin_percent=excluded.target_margin_percent;

alter table public.billing_plans enable row level security;
alter table public.credit_wallets enable row level security;
alter table public.credit_ledger enable row level security;
alter table public.model_cost_rules enable row level security;
alter table public.credit_reservations enable row level security;
alter table public.payment_records enable row level security;

create or replace function public.get_or_create_credit_wallet(p_user_id uuid)
returns public.credit_wallets
language plpgsql
security definer
set search_path = public
as $$
declare result public.credit_wallets;
begin
  insert into public.credit_wallets(user_id) values (p_user_id) on conflict (user_id) do nothing;
  select * into result from public.credit_wallets where user_id=p_user_id;
  return result;
end;
$$;

create or replace function public.calculate_customer_price(p_provider_cost_cents numeric, p_margin_percent numeric default 45)
returns numeric
language sql
immutable
as $$ select round(p_provider_cost_cents / greatest(0.01, 1 - p_margin_percent / 100.0), 2); $$;

create or replace function public.reserve_credits(p_user_id uuid, p_credits integer, p_reference_id text default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare current_balance integer;
begin
  if p_credits <= 0 then raise exception 'Credits must be positive'; end if;
  insert into public.credit_wallets(user_id) values (p_user_id) on conflict (user_id) do nothing;
  select balance into current_balance from public.credit_wallets where user_id=p_user_id for update;
  if current_balance < p_credits then return false; end if;
  update public.credit_wallets set balance=balance-p_credits, updated_at=now() where user_id=p_user_id;
  insert into public.credit_ledger(user_id,amount,entry_type,reference_id,description) values (p_user_id,-p_credits,'reservation',p_reference_id,'Generation credit reservation');
  return true;
end;
$$;

create or replace function public.release_credits(p_user_id uuid, p_credits integer, p_reference_id text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_credits <= 0 then return; end if;
  update public.credit_wallets set balance=balance+p_credits, updated_at=now() where user_id=p_user_id;
  insert into public.credit_ledger(user_id,amount,entry_type,reference_id,description) values (p_user_id,p_credits,'release',p_reference_id,'Released generation reservation');
end;
$$;

revoke all on function public.get_or_create_credit_wallet(uuid) from public;
revoke all on function public.reserve_credits(uuid,integer,text) from public;
revoke all on function public.release_credits(uuid,integer,text) from public;
grant execute on function public.get_or_create_credit_wallet(uuid) to service_role;
grant execute on function public.reserve_credits(uuid,integer,text) to service_role;
grant execute on function public.release_credits(uuid,integer,text) to service_role;
