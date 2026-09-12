-- Backfill the missing admin audit tables and privileged admin/payout RPCs so
-- the repository contains the security-critical control-plane logic that the
-- application already calls in production.
--
-- This migration is written to be safe on an existing production database that
-- already has a `user_admin_actions` table with a simpler legacy schema:
--   id, admin_user_id, target_user_id, action, credits, note, created_at
-- It upgrades that table in-place to the richer audit schema.

-- 1) Ensure the richer user_admin_actions schema exists and migrate legacy rows

alter table public.user_admin_actions
  add column if not exists action_type text,
  add column if not exists old_value jsonb,
  add column if not exists new_value jsonb,
  add column if not exists reason text;

-- Populate the new columns from the legacy ones where they are still null
update public.user_admin_actions
set
  action_type = action,
  reason = note,
  new_value = case
    when action = 'grant_bonus' and credits is not null
      then jsonb_build_object('credits', credits)
    else new_value
  end
where action_type is null;

-- Now that we have migrated, enforce not-null on the new schema
alter table public.user_admin_actions
  alter column action_type set not null;

-- Drop the legacy columns
alter table public.user_admin_actions
  drop column if exists action,
  drop column if exists credits,
  drop column if exists note;

create index if not exists user_admin_actions_admin_created_idx
  on public.user_admin_actions(admin_user_id, created_at desc);

alter table public.user_admin_actions enable row level security;
revoke all on public.user_admin_actions from public, anon, authenticated;
grant select on public.user_admin_actions to service_role;

-- 2) Revenue split audit table

create table if not exists public.revenue_split_audit (
  id uuid primary key default gen_random_uuid(),
  changed_by uuid references auth.users(id) on delete set null,
  old_split jsonb,
  new_split jsonb not null,
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists revenue_split_audit_changed_idx
  on public.revenue_split_audit(changed_by, created_at desc);

alter table public.revenue_split_audit enable row level security;
revoke all on public.revenue_split_audit from public, anon, authenticated;
grant select on public.revenue_split_audit to service_role;

-- 3) Admin RPC functions

create or replace function public.admin_grant_bonus(
  p_target_user_id uuid,
  p_credits integer,
  p_note text default null
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_admin_id uuid := auth.uid();
begin
  if not public.is_cinex_admin(v_admin_id) then
    raise exception 'Not authorised';
  end if;
  if p_target_user_id is null or p_credits is null or p_credits <= 0 then
    raise exception 'Credits must be positive';
  end if;

  perform public.get_or_create_credit_wallet(p_target_user_id);

  update public.credit_wallets
     set balance = balance + p_credits,
         updated_at = now()
   where user_id = p_target_user_id;

  insert into public.credit_ledger(user_id, amount, entry_type, reference_id, description)
  values (
    p_target_user_id,
    p_credits,
    'grant',
    null,
    coalesce(nullif(trim(p_note), ''), 'Admin bonus credits granted')
  );

  insert into public.user_admin_actions(admin_user_id, action_type, target_user_id, new_value, reason)
  values (
    v_admin_id,
    'grant_bonus',
    p_target_user_id,
    jsonb_build_object('credits', p_credits),
    p_note
  );

  return p_credits;
end;
$$;

revoke all on function public.admin_grant_bonus(uuid, integer, text) from public, anon;
grant execute on function public.admin_grant_bonus(uuid, integer, text) to authenticated;

create or replace function public.admin_set_user_active(
  p_target_user_id uuid,
  p_active boolean,
  p_reason text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_admin_id uuid := auth.uid();
  v_old_active boolean;
  v_old_reason text;
begin
  if not public.is_cinex_admin(v_admin_id) then
    raise exception 'Not authorised';
  end if;

  select active, reason
    into v_old_active, v_old_reason
    from public.user_account_status
   where user_id = p_target_user_id
   for update;

  if not found then
    raise exception 'User account status not found';
  end if;

  update public.user_account_status
     set active = p_active,
         reason = p_reason
   where user_id = p_target_user_id;

  insert into public.user_admin_actions(
    admin_user_id, action_type, target_user_id, old_value, new_value, reason
  )
  values (
    v_admin_id,
    'set_user_active',
    p_target_user_id,
    jsonb_build_object('active', v_old_active, 'reason', v_old_reason),
    jsonb_build_object('active', p_active, 'reason', p_reason),
    p_reason
  );

  return jsonb_build_object('success', true, 'user_id', p_target_user_id, 'active', p_active);
end;
$$;

revoke all on function public.admin_set_user_active(uuid, boolean, text) from public, anon;
grant execute on function public.admin_set_user_active(uuid, boolean, text) to authenticated;

create or replace function public.admin_set_discount(
  p_enabled boolean,
  p_percent numeric,
  p_label text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_admin_id uuid := auth.uid();
  v_old_setting jsonb;
  v_new_setting jsonb;
begin
  if not public.is_cinex_admin(v_admin_id) then
    raise exception 'Not authorised';
  end if;
  if p_percent < 0 or p_percent > 100 then
    raise exception 'Discount percent must be 0-100';
  end if;

  select value into v_old_setting
    from public.app_settings
   where key = 'discount_mode'
   for update;

  v_new_setting := jsonb_build_object(
    'enabled', p_enabled,
    'percent', p_percent,
    'label', coalesce(nullif(trim(p_label), ''), 'Staff discount')
  );

  insert into public.app_settings(key, value)
  values ('discount_mode', v_new_setting)
  on conflict (key) do update
    set value = excluded.value;

  insert into public.user_admin_actions(admin_user_id, action_type, old_value, new_value)
  values (v_admin_id, 'set_discount', v_old_setting, v_new_setting);

  return jsonb_build_object('success', true, 'discount', v_new_setting);
end;
$$;

revoke all on function public.admin_set_discount(boolean, numeric, text) from public, anon;
grant execute on function public.admin_set_discount(boolean, numeric, text) to authenticated;

create or replace function public.admin_set_maintenance(
  p_enabled boolean,
  p_message text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_admin_id uuid := auth.uid();
  v_old_setting jsonb;
  v_new_setting jsonb;
begin
  if not public.is_cinex_admin(v_admin_id) then
    raise exception 'Not authorised';
  end if;

  select value into v_old_setting
    from public.app_settings
   where key = 'maintenance_mode'
   for update;

  v_new_setting := jsonb_build_object(
    'enabled', p_enabled,
    'message', case
      when p_enabled then coalesce(nullif(trim(p_message), ''), 'Maintenance in progress. Services will resume shortly.')
      else nullif(trim(p_message), '')
    end,
    'started_at', case when p_enabled then now() else null end
  );

  insert into public.app_settings(key, value)
  values ('maintenance_mode', v_new_setting)
  on conflict (key) do update
    set value = excluded.value;

  insert into public.user_admin_actions(admin_user_id, action_type, old_value, new_value)
  values (v_admin_id, 'set_maintenance', v_old_setting, v_new_setting);

  return jsonb_build_object('success', true, 'maintenance_enabled', p_enabled);
end;
$$;

revoke all on function public.admin_set_maintenance(boolean, text) from public, anon;
grant execute on function public.admin_set_maintenance(boolean, text) to authenticated;

create or replace function public.admin_set_revenue_split(
  p_platform_percent numeric,
  p_basis text,
  p_reason text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_admin_id uuid := auth.uid();
  v_old_split jsonb;
  v_new_split jsonb;
begin
  if not public.is_cinex_super_admin(v_admin_id) then
    raise exception 'Super admin authorisation required';
  end if;
  if p_platform_percent < 0 or p_platform_percent > 100 then
    raise exception 'Platform percent must be 0-100';
  end if;
  if p_basis not in ('net', 'gross') then
    raise exception 'Split basis must be net or gross';
  end if;

  select value into v_old_split
    from public.app_settings
   where key = 'revenue_split'
   for update;

  v_new_split := jsonb_build_object(
    'platform_percent', p_platform_percent,
    'basis', p_basis,
    'effective_from', now()
  );

  insert into public.app_settings(key, value)
  values ('revenue_split', v_new_split)
  on conflict (key) do update
    set value = excluded.value;

  insert into public.revenue_split_audit(changed_by, old_split, new_split, reason)
  values (v_admin_id, v_old_split, v_new_split, p_reason);

  insert into public.user_admin_actions(admin_user_id, action_type, old_value, new_value, reason)
  values (v_admin_id, 'set_revenue_split', v_old_split, v_new_split, p_reason);

  return jsonb_build_object('success', true, 'revenue_split', v_new_split);
end;
$$;

revoke all on function public.admin_set_revenue_split(numeric, text, text) from public, anon;
grant execute on function public.admin_set_revenue_split(numeric, text, text) to authenticated;

create or replace function public.open_partner_payout(
  p_partner_id uuid,
  p_provider text,
  p_note text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_admin_id uuid := auth.uid();
  v_amount_cents integer;
  v_payout_id uuid;
begin
  if not public.is_cinex_super_admin(v_admin_id) then
    raise exception 'Super admin authorisation required';
  end if;

  perform 1
    from public.revenue_partners
   where id = p_partner_id
   for update;
  if not found then
    raise exception 'Partner not found';
  end if;

  select coalesce(sum(amount_cents), 0)
    into v_amount_cents
    from public.partner_earnings
   where partner_id = p_partner_id
     and payout_id is null;

  if v_amount_cents <= 0 then
    return null;
  end if;

  insert into public.partner_payouts(partner_id, amount_cents, provider, status, note, created_by)
  values (
    p_partner_id,
    v_amount_cents,
    coalesce(nullif(trim(p_provider), ''), 'manual'),
    'pending',
    p_note,
    v_admin_id
  )
  returning id into v_payout_id;

  update public.partner_earnings
     set payout_id = v_payout_id
   where partner_id = p_partner_id
     and payout_id is null;

  insert into public.user_admin_actions(admin_user_id, action_type, new_value, reason)
  values (
    v_admin_id,
    'open_partner_payout',
    jsonb_build_object('partner_id', p_partner_id, 'payout_id', v_payout_id, 'amount_cents', v_amount_cents, 'provider', p_provider),
    p_note
  );

  return v_payout_id;
end;
$$;

revoke all on function public.open_partner_payout(uuid, text, text) from public, anon;
grant execute on function public.open_partner_payout(uuid, text, text) to authenticated;

create or replace function public.settle_partner_payout(
  p_payout_id uuid,
  p_status text,
  p_provider_transfer_id text default null
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_payout public.partner_payouts;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required';
  end if;
  if p_status not in ('paid', 'failed', 'cancelled') then
    raise exception 'Invalid payout status';
  end if;

  select * into v_payout
    from public.partner_payouts
   where id = p_payout_id
   for update;

  if not found then
    raise exception 'Payout not found';
  end if;

  update public.partner_payouts
     set status = p_status,
         provider_transfer_id = coalesce(p_provider_transfer_id, provider_transfer_id),
         completed_at = case when p_status = 'paid' then now() else completed_at end
   where id = p_payout_id;

  if p_status in ('failed', 'cancelled') then
    update public.partner_earnings
       set payout_id = null
     where payout_id = p_payout_id;
  end if;

  return true;
end;
$$;

revoke all on function public.settle_partner_payout(uuid, text, text) from public, anon, authenticated;
grant execute on function public.settle_partner_payout(uuid, text, text) to service_role;
