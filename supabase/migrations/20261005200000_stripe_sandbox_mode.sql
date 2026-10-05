-- Track whether a plan was bought in the Stripe sandbox or live.
alter table public.user_subscriptions add column if not exists livemode boolean not null default true;
-- Customer payments start in the sandbox; a super admin switches to live in the admin area.
insert into public.app_settings (key, value) values ('payment_mode', '{"mode":"test"}'::jsonb)
on conflict (key) do nothing;
