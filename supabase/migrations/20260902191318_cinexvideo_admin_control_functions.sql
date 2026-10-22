-- Applied to production as version 20260902191318 (cinexvideo_admin_control_functions).
-- Content exported verbatim from supabase_migrations.schema_migrations.

create table if not exists public.admin_members (user_id uuid primary key references auth.users(id) on delete cascade, created_at timestamptz not null default now(), created_by uuid references auth.users(id) on delete set null);
create table if not exists public.user_account_status (user_id uuid primary key references auth.users(id) on delete cascade, active boolean not null default true, updated_at timestamptz not null default now(), updated_by uuid references auth.users(id) on delete set null, reason text);
alter table public.admin_members enable row level security;
alter table public.user_account_status enable row level security;

create or replace function public.is_cinex_admin(p_user_id uuid default auth.uid()) returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from public.admin_members where user_id=p_user_id); $$;

create or replace function public.admin_grant_bonus(p_target_user_id uuid, p_credits integer, p_note text default null) returns void language plpgsql security definer set search_path=public as $$ begin if not public.is_cinex_admin(auth.uid()) then raise exception 'Admin access required'; end if; if p_credits <= 0 then raise exception 'Credits must be positive'; end if; insert into public.credit_wallets(user_id,balance,lifetime_purchased) values(p_target_user_id,p_credits,p_credits) on conflict(user_id) do update set balance=credit_wallets.balance+p_credits,lifetime_purchased=credit_wallets.lifetime_purchased+p_credits,updated_at=now(); insert into public.credit_ledger(user_id,amount,entry_type,description) values(p_target_user_id,p_credits,'grant',coalesce(p_note,'Admin bonus credits')); insert into public.user_admin_actions(admin_user_id,target_user_id,action,credits,note) values(auth.uid(),p_target_user_id,'grant_bonus',p_credits,p_note); end; $$;

create or replace function public.admin_set_discount(p_enabled boolean, p_percent numeric default 0, p_label text default null) returns void language plpgsql security definer set search_path=public as $$ begin if not public.is_cinex_admin(auth.uid()) then raise exception 'Admin access required'; end if; if p_percent < 0 or p_percent > 100 then raise exception 'Invalid discount'; end if; insert into public.app_settings(key,value,updated_by) values('discount_mode',jsonb_build_object('enabled',p_enabled,'percent',p_percent,'label',coalesce(p_label,'')),auth.uid()) on conflict(key) do update set value=excluded.value,updated_by=auth.uid(),updated_at=now(); insert into public.user_admin_actions(admin_user_id,action,note) values(auth.uid(),'toggle_discount',concat('enabled=',p_enabled,', percent=',p_percent)); end; $$;

create or replace function public.admin_set_maintenance(p_enabled boolean, p_message text default null) returns void language plpgsql security definer set search_path=public as $$ begin if not public.is_cinex_admin(auth.uid()) then raise exception 'Admin access required'; end if; insert into public.app_settings(key,value,updated_by) values('maintenance_mode',jsonb_build_object('enabled',p_enabled,'message',coalesce(p_message,'CinexVideo is undergoing scheduled maintenance. Please check back soon.')),auth.uid()) on conflict(key) do update set value=excluded.value,updated_by=auth.uid(),updated_at=now(); insert into public.user_admin_actions(admin_user_id,action,note) values(auth.uid(),'toggle_maintenance',concat('enabled=',p_enabled)); end; $$;

create or replace function public.admin_set_user_active(p_target_user_id uuid, p_active boolean, p_reason text default null) returns void language plpgsql security definer set search_path=public as $$ begin if not public.is_cinex_admin(auth.uid()) then raise exception 'Admin access required'; end if; insert into public.user_account_status(user_id,active,updated_by,reason) values(p_target_user_id,p_active,auth.uid(),p_reason) on conflict(user_id) do update set active=excluded.active,updated_by=auth.uid(),updated_at=now(),reason=excluded.reason; insert into public.user_admin_actions(admin_user_id,target_user_id,action,note) values(auth.uid(),p_target_user_id,case when p_active then 'add_user' else 'remove_user' end,p_reason); end; $$;

revoke all on function public.admin_grant_bonus(uuid,integer,text) from public;
revoke all on function public.admin_set_discount(boolean,numeric,text) from public;
revoke all on function public.admin_set_maintenance(boolean,text) from public;
revoke all on function public.admin_set_user_active(uuid,boolean,text) from public;
grant execute on function public.admin_grant_bonus(uuid,integer,text) to authenticated;
grant execute on function public.admin_set_discount(boolean,numeric,text) to authenticated;
grant execute on function public.admin_set_maintenance(boolean,text) to authenticated;
grant execute on function public.admin_set_user_active(uuid,boolean,text) to authenticated;
