-- Restrict sensitive views and SECURITY DEFINER functions that inherited
-- overly broad public-schema privileges. Application API routes use the
-- service role; admin mutation routes use an authenticated user token and
-- perform their own is_cinex_admin/is_cinex_super_admin checks.

-- Views execute with the caller's privileges so they cannot bypass underlying
-- RLS. None of these views is read directly by the browser.
alter view public.admin_cockpit_summary set (security_invoker = true);
alter view public.cinexvideo_payments set (security_invoker = true);
alter view public.customer_visible_operations set (security_invoker = true);
alter view public.customer_visible_plans set (security_invoker = true);
alter view public.partner_balances set (security_invoker = true);

revoke all on public.admin_cockpit_summary from public, anon, authenticated;
revoke all on public.cinexvideo_payments from public, anon, authenticated;
revoke all on public.customer_visible_operations from public, anon, authenticated;
revoke all on public.customer_visible_plans from public, anon, authenticated;
revoke all on public.partner_balances from public, anon, authenticated;

grant select on public.admin_cockpit_summary to service_role;
grant select on public.cinexvideo_payments to service_role;
grant select on public.customer_visible_operations to service_role;
grant select on public.customer_visible_plans to service_role;
grant select on public.partner_balances to service_role;

-- Anonymous users never need to invoke a SECURITY DEFINER function.
revoke execute on function public.admin_grant_bonus(uuid, integer, text) from public, anon;
revoke execute on function public.admin_set_discount(boolean, numeric, text) from public, anon;
revoke execute on function public.admin_set_maintenance(boolean, text) from public, anon;
revoke execute on function public.admin_set_revenue_split(numeric, text) from public, anon;
revoke execute on function public.admin_set_user_active(uuid, boolean, text) from public, anon;
revoke execute on function public.open_partner_payout(uuid, text, text) from public, anon;

-- These admin functions are intentionally invoked with the signed-in admin's
-- JWT so auth.uid() can be audited inside the database function.
grant execute on function public.admin_grant_bonus(uuid, integer, text) to authenticated;
grant execute on function public.admin_set_discount(boolean, numeric, text) to authenticated;
grant execute on function public.admin_set_maintenance(boolean, text) to authenticated;
grant execute on function public.admin_set_revenue_split(numeric, text) to authenticated;
grant execute on function public.admin_set_user_active(uuid, boolean, text) to authenticated;
grant execute on function public.open_partner_payout(uuid, text, text) to authenticated;

-- Pricing, settlement, onboarding and identity helpers are server-only.
revoke execute on function public.cinex_onboard_user() from public, anon, authenticated;
revoke execute on function public.customer_export_quote(text, text, text) from public, anon, authenticated;
revoke execute on function public.customer_quote(text, text, text, numeric, integer, text, integer) from public, anon, authenticated;
revoke execute on function public.quote_generation(text, text, text, numeric, integer, text, integer) from public, anon, authenticated;
revoke execute on function public.settle_partner_payout(uuid, text, text) from public, anon, authenticated;

grant execute on function public.cinex_onboard_user() to service_role;
grant execute on function public.customer_export_quote(text, text, text) to service_role;
grant execute on function public.customer_quote(text, text, text, numeric, integer, text, integer) to service_role;
grant execute on function public.quote_generation(text, text, text, numeric, integer, text, integer) to service_role;
grant execute on function public.settle_partner_payout(uuid, text, text) to service_role;

-- These helpers participate in authenticated RLS policies. Keep authenticated
-- access, but remove anonymous execution.
revoke execute on function public.is_cinex_admin(uuid) from public, anon;
revoke execute on function public.is_cinex_super_admin(uuid) from public, anon;
grant execute on function public.is_cinex_admin(uuid) to authenticated, service_role;
grant execute on function public.is_cinex_super_admin(uuid) to authenticated, service_role;
