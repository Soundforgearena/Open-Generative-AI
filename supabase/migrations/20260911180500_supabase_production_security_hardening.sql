-- Production Supabase hardening for sensitive public-schema tables and admin
-- helper functions. The application reads these relations only through
-- service-role server routes or SECURITY DEFINER RPCs, so browser roles should
-- never access them directly through PostgREST.

create or replace function public.is_cinex_admin(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_user_id is null then false
    when auth.role() = 'service_role' then exists(
      select 1 from public.admin_members where user_id = p_user_id
    )
    when auth.uid() is not null and p_user_id = auth.uid() then exists(
      select 1 from public.admin_members where user_id = p_user_id
    )
    else false
  end;
$$;

create or replace function public.is_cinex_super_admin(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_user_id is null then false
    when auth.role() = 'service_role' then exists(
      select 1 from public.admin_members where user_id = p_user_id and role = 'super_admin'
    )
    when auth.uid() is not null and p_user_id = auth.uid() then exists(
      select 1 from public.admin_members where user_id = p_user_id and role = 'super_admin'
    )
    else false
  end;
$$;

revoke execute on function public.is_cinex_admin(uuid) from public, anon;
revoke execute on function public.is_cinex_super_admin(uuid) from public, anon;
grant execute on function public.is_cinex_admin(uuid) to authenticated, service_role;
grant execute on function public.is_cinex_super_admin(uuid) to authenticated, service_role;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'admin_members',
    'app_settings',
    'user_account_status',
    'credit_wallets',
    'credit_ledger',
    'payment_records',
    'credit_packs',
    'model_cost_rules',
    'export_jobs',
    'admin_health_snapshots',
    'admin_metric_events'
  ] loop
    if to_regclass('public.' || table_name) is not null then
      execute format('alter table public.%I enable row level security', table_name);
      execute format('revoke all on table public.%I from public, anon, authenticated', table_name);
    end if;
  end loop;
end $$;
