-- Revenue partner amendment (October 2026), one account per partner, global
-- Stripe Express payouts, and a service-only monthly payout RPC.
--
-- Split of NET revenue (after provider costs, overhead and payment fees):
--   Platform 30%, BeatKitBuilder (super admin) 40%, King Beat Exclusives 10%,
--   Isaiah Walusimbi 5%, Isaac K. Walusimbi 5%, Ally Greene 5%,
--   Official Amaziah Music 5%.  Total 100%.
-- share_percent is a percent of net revenue; record_revenue() pays
-- distributable * share / sum(shares), which equals net * share.

-- 1. One identity per person. Gmail ignores dots and +tags, so
--    "isaac.kwalusimbi+x@gmail.com" is the same inbox as
--    "isaackwalusimbi@gmail.com" and must not become a second partner.
create or replace function public.cinex_normalize_email(p_email text)
returns text language sql immutable as $$
  select case
    when split_part(lower(trim(p_email)), '@', 2) in ('gmail.com', 'googlemail.com')
      then replace(split_part(split_part(lower(trim(p_email)), '@', 1), '+', 1), '.', '') || '@gmail.com'
    else lower(trim(p_email))
  end;
$$;

update public.revenue_partners set email = lower(trim(email)) where email <> lower(trim(email));

alter table public.revenue_partners
  add column if not exists payout_country text check (payout_country is null or payout_country ~ '^[A-Z]{2}$'),
  add column if not exists stripe_account_history jsonb not null default '[]'::jsonb;

create unique index if not exists revenue_partners_identity_idx on public.revenue_partners (public.cinex_normalize_email(email));
create unique index if not exists revenue_partners_user_idx on public.revenue_partners (user_id) where user_id is not null;
create unique index if not exists revenue_partners_stripe_idx on public.revenue_partners (stripe_account_id) where stripe_account_id is not null;

-- 2. The new split.
insert into public.revenue_partners (email, display_name, share_percent, active, payout_provider) values
  ('beatkitbuilder@gmail.com',       'BeatKitBuilder',         40, true, 'stripe_express'),
  ('kingbeatexclusives@gmail.com',   'King Beat Exclusives',   10, true, 'stripe_express'),
  ('isaiahwalusimbi@gmail.com',      'Isaiah Walusimbi',        5, true, 'stripe_express'),
  ('isaackwalusimbi@gmail.com',      'Isaac K. Walusimbi',      5, true, 'stripe_express'),
  ('allygreene82@gmail.com',         'Ally Greene',             5, true, 'stripe_express'),
  ('officialamaziahmusic@gmail.com', 'Official Amaziah Music',  5, true, 'stripe_express')
on conflict ((public.cinex_normalize_email(email))) do update set
  share_percent = excluded.share_percent,
  display_name = excluded.display_name,
  active = true,
  payout_provider = 'stripe_express',
  updated_at = now();

update public.revenue_partners set active = false, updated_at = now()
 where public.cinex_normalize_email(email) not in (
   'beatkitbuilder@gmail.com', 'kingbeatexclusives@gmail.com', 'isaiahwalusimbi@gmail.com',
   'isaackwalusimbi@gmail.com', 'allygreene82@gmail.com', 'officialamaziahmusic@gmail.com');

-- Nobody is marked payout-ready without a connected Stripe account.
update public.revenue_partners set payouts_enabled = false, onboarding_status = 'not_started'
 where stripe_account_id is null;

-- Link partners who already have a CineXVideo account.
update public.revenue_partners rp set user_id = u.id, updated_at = now()
  from auth.users u
 where rp.user_id is null
   and public.cinex_normalize_email(u.email) = public.cinex_normalize_email(rp.email)
   and not exists (select 1 from public.revenue_partners o where o.user_id = u.id);

insert into public.revenue_split_audit (old_split, new_split, reason)
select value, '{"platform_percent": 30, "basis": "net"}'::jsonb, 'October 2026 partner amendment'
  from public.app_settings where key = 'revenue_split';

insert into public.app_settings (key, value) values ('revenue_split', '{"platform_percent": 30, "basis": "net"}'::jsonb)
on conflict (key) do update set value = excluded.value;

-- 3. Admin roles. New admins become admins when they first sign in.
insert into public.admin_invites (email, role, note) values
  ('isaiahwalusimbi@gmail.com', 'admin', 'Revenue partner'),
  ('isaackwalusimbi@gmail.com', 'admin', 'Revenue partner'),
  ('allygreene82@gmail.com',    'admin', 'Revenue partner')
on conflict (email) do update set role = excluded.role, note = excluded.note;

-- 4. Signup links invites and partner rows by normalised email, and only
--    ever to the first account, so one person can never hold two partner rows.
create or replace function public.cinex_onboard_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_email text; v_role text;
begin
  v_email := public.cinex_normalize_email(new.email);

  insert into public.user_account_status(user_id, active)
  values (new.id, true) on conflict (user_id) do nothing;

  insert into public.credit_wallets(user_id, balance)
  values (new.id, coalesce((select (value->>'signup_credits')::int from public.app_settings where key = 'signup_credits'), 0))
  on conflict (user_id) do nothing;

  select role into v_role from public.admin_invites
   where public.cinex_normalize_email(email) = v_email and claimed_at is null
   limit 1;

  if v_role is not null then
    insert into public.admin_members(user_id, role) values (new.id, v_role)
    on conflict (user_id) do update set role = excluded.role;

    update public.admin_invites
       set claimed_at = now(), claimed_by = new.id
     where public.cinex_normalize_email(email) = v_email and claimed_at is null;
  end if;

  update public.revenue_partners set user_id = new.id, updated_at = now()
   where public.cinex_normalize_email(email) = v_email and user_id is null;

  return new;
end;
$$;

-- 5. Monthly payouts from the cron job (service role only). Same logic as
--    open_partner_payout: earnings are attached to exactly one payout row.
create or replace function public.open_partner_payout_system(p_partner_id uuid, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_amount integer; v_payout uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required';
  end if;
  perform 1 from public.revenue_partners where id = p_partner_id and active for update;
  if not found then return null; end if;
  -- Never open a second payout while one is still in flight.
  if exists (select 1 from public.partner_payouts where partner_id = p_partner_id and status = 'pending') then
    return null;
  end if;
  select coalesce(sum(amount_cents), 0) into v_amount
    from public.partner_earnings where partner_id = p_partner_id and payout_id is null;
  if v_amount <= 0 then return null; end if;
  insert into public.partner_payouts(partner_id, amount_cents, provider, status, note)
  values (p_partner_id, v_amount, 'stripe_express', 'pending', p_note)
  returning id into v_payout;
  update public.partner_earnings set payout_id = v_payout
   where partner_id = p_partner_id and payout_id is null;
  return v_payout;
end;
$$;
revoke all on function public.open_partner_payout_system(uuid, text) from public, anon, authenticated;
grant execute on function public.open_partner_payout_system(uuid, text) to service_role;
