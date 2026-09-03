-- Every new signup gets an active account status and a credit wallet.
-- The very first account to ever sign up is promoted to admin, so the owner
-- can reach the Admin Cockpit without any manual SQL.
create or replace function public.cinex_onboard_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_first boolean;
begin
  insert into public.user_account_status(user_id, active)
  values (new.id, true) on conflict (user_id) do nothing;

  insert into public.credit_wallets(user_id, balance)
  values (new.id, coalesce((select (value->>'signup_credits')::int from public.app_settings where key = 'signup_credits'), 0))
  on conflict (user_id) do nothing;

  select not exists (select 1 from public.admin_members) into v_first;
  if v_first then
    insert into public.admin_members(user_id) values (new.id) on conflict (user_id) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists cinex_onboard_user on auth.users;
create trigger cinex_onboard_user after insert on auth.users
  for each row execute function public.cinex_onboard_user();

insert into public.app_settings(key, value)
values ('signup_credits', '{"signup_credits": 250}'::jsonb)
on conflict (key) do nothing;
