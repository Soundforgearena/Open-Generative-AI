-- Applied to production as version 20261018173703 (super_admin_money_guards).
-- Content exported verbatim from supabase_migrations.schema_migrations.

create or replace function public.admin_grant_bonus(p_target_user_id uuid, p_credits integer, p_note text default null)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_admin_id uuid := auth.uid();
begin
  if not public.is_cinex_super_admin(v_admin_id) then
    raise exception 'Not authorised';
  end if;
  if p_target_user_id is null or p_credits is null or p_credits <= 0 then
    raise exception 'Credits must be positive';
  end if;
  if p_credits > 10000 then
    raise exception 'Grant at most 10000 credits at a time';
  end if;

  perform public.get_or_create_credit_wallet(p_target_user_id);

  update public.credit_wallets
     set balance = balance + p_credits,
         updated_at = now()
   where user_id = p_target_user_id;

  insert into public.credit_ledger(user_id, amount, entry_type, reference_id, description)
  values (p_target_user_id, p_credits, 'grant', null, coalesce(nullif(trim(p_note), ''), 'Admin bonus credits granted'));

  insert into public.user_admin_actions(admin_user_id, action_type, target_user_id, new_value, reason)
  values (v_admin_id, 'grant_bonus', p_target_user_id, jsonb_build_object('credits', p_credits), p_note);

  return p_credits;
end;
$function$;

create or replace function public.admin_set_discount(p_enabled boolean, p_percent numeric, p_label text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_admin_id uuid := auth.uid();
  v_old_setting jsonb;
  v_new_setting jsonb;
begin
  if not public.is_cinex_super_admin(v_admin_id) then
    raise exception 'Not authorised';
  end if;
  if p_percent < 0 or p_percent > 100 then
    raise exception 'Discount percent must be 0-100';
  end if;

  select value into v_old_setting from public.app_settings where key = 'discount_mode' for update;

  v_new_setting := jsonb_build_object(
    'enabled', p_enabled,
    'percent', p_percent,
    'label', coalesce(nullif(trim(p_label), ''), 'Staff discount')
  );

  insert into public.app_settings(key, value) values ('discount_mode', v_new_setting)
  on conflict (key) do update set value = excluded.value;

  insert into public.user_admin_actions(admin_user_id, action_type, old_value, new_value)
  values (v_admin_id, 'set_discount', v_old_setting, v_new_setting);

  return jsonb_build_object('success', true, 'discount', v_new_setting);
end;
$function$;

create or replace function public.admin_set_user_active(p_target_user_id uuid, p_active boolean, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_admin_id uuid := auth.uid();
  v_old_active boolean;
  v_old_reason text;
begin
  if not public.is_cinex_admin(v_admin_id) then
    raise exception 'Not authorised';
  end if;
  if p_target_user_id = v_admin_id then
    raise exception 'You cannot change your own account status';
  end if;
  if exists (select 1 from public.admin_members where user_id = p_target_user_id)
     and not public.is_cinex_super_admin(v_admin_id) then
    raise exception 'Only the super admin can change another admin';
  end if;

  select active, reason into v_old_active, v_old_reason
    from public.user_account_status where user_id = p_target_user_id for update;
  if not found then
    raise exception 'User account status not found';
  end if;

  update public.user_account_status set active = p_active, reason = p_reason where user_id = p_target_user_id;

  insert into public.user_admin_actions(admin_user_id, action_type, target_user_id, old_value, new_value, reason)
  values (
    v_admin_id, 'set_user_active', p_target_user_id,
    jsonb_build_object('active', v_old_active, 'reason', v_old_reason),
    jsonb_build_object('active', p_active, 'reason', p_reason),
    p_reason
  );

  return jsonb_build_object('success', true, 'user_id', p_target_user_id, 'active', p_active);
end;
$function$;

revoke all on function public.admin_grant_bonus(uuid, integer, text) from public, anon;
revoke all on function public.admin_set_discount(boolean, numeric, text) from public, anon;
revoke all on function public.admin_set_user_active(uuid, boolean, text) from public, anon;
grant execute on function public.admin_grant_bonus(uuid, integer, text) to authenticated;
grant execute on function public.admin_set_discount(boolean, numeric, text) to authenticated;
grant execute on function public.admin_set_user_active(uuid, boolean, text) to authenticated;
