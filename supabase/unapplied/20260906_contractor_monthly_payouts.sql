-- Monthly contractor payout configuration and idempotency.
-- Revenue is still derived from revenue_events by the protected cron route.

alter table public.revenue_partners
  add column if not exists contractor_key text,
  add column if not exists payout_units integer;

alter table public.revenue_partners
  drop constraint if exists revenue_partners_payout_units_check;
alter table public.revenue_partners
  add constraint revenue_partners_payout_units_check
  check (payout_units is null or payout_units > 0);

insert into public.revenue_partners(
  email, display_name, share_percent, active, payout_provider, contractor_key, payout_units
) values
  ('beatkitbuilder@gmail.com', 'BeatKitBuilder', 0, true, 'manual', 'beatkit', 36),
  ('kingbeatexclusives@gmail.com', 'King Beat Exclusives', 0, true, 'manual', 'kingbeat', 5),
  ('allygreen82@gmail.com', 'Ally Green', 0, true, 'manual', 'ally', 5),
  ('OfficialAmaziahMusic@gmail.com', 'Official Amaziah Music', 0, true, 'manual', 'officialamaziah', 5),
  ('Isaackwalusimbi@gmail.com', 'Isaac K. Walusimbi', 0, true, 'manual', 'isaackwalusimbi', 4),
  ('isaiahwalusimbi@gmail.com', 'Isaiah Walusimbi', 0, true, 'manual', 'isaiahwalusimbi', 4)
on conflict (email) do update set
  display_name = excluded.display_name,
  contractor_key = excluded.contractor_key,
  payout_units = excluded.payout_units,
  updated_at = now();

alter table public.partner_payouts
  add column if not exists period text,
  add column if not exists raw_share_cents integer,
  add column if not exists excess_to_platform_cents integer not null default 0;

alter table public.partner_payouts
  drop constraint if exists partner_payouts_period_check;
alter table public.partner_payouts
  add constraint partner_payouts_period_check
  check (period is null or period ~ '^\d{4}-(0[1-9]|1[0-2])$');

create unique index if not exists partner_payouts_partner_period_idx
  on public.partner_payouts(partner_id, period)
  where period is not null;

create index if not exists revenue_events_created_at_idx
  on public.revenue_events(created_at);

-- Do not let the public client mutate payout records.
revoke all on public.partner_payouts from anon, authenticated;
