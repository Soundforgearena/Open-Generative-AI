-- Applied to production as version 20260903162211 (cinexvideo_admin_set_revenue_split).
-- Content exported verbatim from supabase_migrations.schema_migrations.

create or replace function public.admin_set_revenue_split(
  p_platform_percent numeric, p_basis text
) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_cinex_super_admin(auth.uid()) then
    raise exception 'Only a super admin can change the revenue split';
  end if;
  if p_platform_percent < 0 or p_platform_percent > 100 then
    raise exception 'Platform share must be between 0 and 100';
  end if;
  if p_basis not in ('net','gross') then
    raise exception 'Basis must be net or gross';
  end if;

  insert into public.app_settings(key, value, updated_at, updated_by)
  values ('revenue_split',
          jsonb_build_object('platform_percent', p_platform_percent, 'basis', p_basis),
          now(), auth.uid())
  on conflict (key) do update
    set value = excluded.value, updated_at = now(), updated_by = auth.uid();

  insert into public.user_admin_actions(admin_user_id, target_user_id, action, note)
  values (auth.uid(), null, 'set_revenue_split',
          format('platform %s%% of %s', p_platform_percent, p_basis));
  return true;
end;
$$;

grant execute on function public.admin_set_revenue_split(numeric, text) to authenticated;
grant execute on function public.open_partner_payout(uuid, text, text) to authenticated;
