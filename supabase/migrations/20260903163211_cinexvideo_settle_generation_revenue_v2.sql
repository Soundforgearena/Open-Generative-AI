-- Applied to production as version 20260903163211 (cinexvideo_settle_generation_revenue_v2).
-- Content exported verbatim from supabase_migrations.schema_migrations.

drop function if exists public.settle_generation_revenue(uuid, text, integer, integer);

-- Called once, when a generation completes.
--
-- Values the consumed credits at what the customer actually paid for them
-- (net of payment fees, tracked per wallet), subtracts the true cost of goods
-- for that model including overhead, and hands the result to the split engine.
--
-- Cost is read from model_cost_rules here rather than passed in by the API
-- route, so pricing logic stays in one place and cannot be spoofed upstream.
create or replace function public.settle_generation_revenue(p_generation_request_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  g public.generation_requests;
  r public.model_cost_rules;
  v_rate numeric;
  v_gross integer;
  v_cost integer;
begin
  select * into g from public.generation_requests where id = p_generation_request_id;
  if not found then return null; end if;

  select * into r from public.model_cost_rules
   where provider = g.provider and model = g.model and operation = g.operation
   limit 1;

  v_cost := coalesce(round(
    coalesce(r.provider_cost_cents, 0)
    + coalesce(r.fixed_overhead_cents, 0)
    + coalesce(r.provider_cost_cents, 0) * coalesce(r.variable_overhead_percent, 0) / 100.0
  )::integer, 0);

  select net_cents_per_credit into v_rate from public.credit_wallets where user_id = g.user_id;
  v_gross := round(coalesce(v_rate, 0) * coalesce(g.credits_reserved, 0))::integer;

  update public.generation_requests
     set provider_cost_cents = v_cost where id = g.id;

  -- Payment fees were already netted out of the per-credit rate at purchase,
  -- so they are not subtracted a second time here.
  return public.record_revenue(
    'generation', g.id::text, g.user_id, v_gross, v_cost, 0, 0
  );
end;
$$;

revoke all on function public.settle_generation_revenue(uuid) from public, anon, authenticated;
