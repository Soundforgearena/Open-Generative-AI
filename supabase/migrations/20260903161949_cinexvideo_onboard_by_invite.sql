-- Applied to production as version 20260903161949 (cinexvideo_onboard_by_invite).
-- Content exported verbatim from supabase_migrations.schema_migrations.

-- Replaces the "first account ever becomes admin" rule, which would have handed
-- ownership to whoever happened to sign up first. Admin rights now come only
-- from an explicit invite, matched on email. Partner records are linked at the
-- same time so earnings attach to the right account.
create or replace function public.cinex_onboard_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_email text; v_role text;
begin
  v_email := lower(trim(new.email));

  insert into public.user_account_status(user_id, active)
  values (new.id, true) on conflict (user_id) do nothing;

  insert into public.credit_wallets(user_id, balance)
  values (new.id, coalesce((select (value->>'signup_credits')::int from public.app_settings where key = 'signup_credits'), 0))
  on conflict (user_id) do nothing;

  select role into v_role from public.admin_invites
   where lower(email) = v_email and claimed_at is null;

  if v_role is not null then
    insert into public.admin_members(user_id, role) values (new.id, v_role)
    on conflict (user_id) do update set role = excluded.role;

    update public.admin_invites
       set claimed_at = now(), claimed_by = new.id
     where lower(email) = v_email;
  end if;

  update public.revenue_partners set user_id = new.id, updated_at = now()
   where lower(email) = v_email and user_id is null;

  return new;
end;
$$;

drop trigger if exists cinex_onboard_user on auth.users;
create trigger cinex_onboard_user after insert on auth.users
  for each row execute function public.cinex_onboard_user();
