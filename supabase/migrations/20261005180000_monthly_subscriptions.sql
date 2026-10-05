-- Monthly plans (1 credit = $0.01, small bonus for committing monthly).
-- Plans stay hidden (active = false) until the owner switches them on.
alter table public.billing_plans add column if not exists blurb text;
alter table public.billing_plans add column if not exists sort_order integer not null default 0;
update public.billing_plans set active = false where code = 'free';
insert into public.billing_plans (code, name, monthly_price_cents, included_credits, overage_price_cents, active, blurb, sort_order) values
  ('creator', 'Creator', 1900, 1950, 0, false, '1,950 credits every month (50 bonus)', 10),
  ('studio',  'Studio',  4900, 5150, 0, false, '5,150 credits every month (250 bonus)', 20),
  ('pro',     'Pro',     9900, 10900, 0, false, '10,900 credits every month (1,000 bonus)', 30)
on conflict (code) do update set name = excluded.name, monthly_price_cents = excluded.monthly_price_cents,
  included_credits = excluded.included_credits, overage_price_cents = 0, blurb = excluded.blurb,
  sort_order = excluded.sort_order;

create or replace view public.customer_visible_plans as
  select code, name, monthly_price_cents, included_credits, overage_price_cents, blurb, sort_order
    from public.billing_plans where active = true;

create table if not exists public.user_subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan_code text not null,
  stripe_customer_id text,
  stripe_subscription_id text unique,
  status text not null default 'incomplete',
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.user_subscriptions enable row level security;
drop policy if exists user_subscriptions_own on public.user_subscriptions;
create policy user_subscriptions_own on public.user_subscriptions for select using (auth.uid() = user_id);
revoke insert, update, delete on public.user_subscriptions from anon, authenticated;
