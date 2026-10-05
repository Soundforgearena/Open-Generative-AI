-- Approved by the owner on 2026-10-05.
-- 1. Credit packs: 1 credit = $0.01, with volume bonuses (matches lib/billing/credit-catalog.js).
update public.credit_packs set active = false;
insert into public.credit_packs (code, name, credits, price_cents, blurb, sort_order, active) values
  ('starter', 'Starter', 1000, 1000, '1,000 credits', 10, true),
  ('creator', 'Creator', 2550, 2500, '2,550 credits (50 bonus)', 20, true),
  ('studio',  'Studio',  5200, 5000, '5,200 credits (200 bonus)', 30, true),
  ('pro',     'Pro',    10800, 10000, '10,800 credits (800 bonus)', 40, true),
  ('agency',  'Agency', 28000, 25000, '28,000 credits (3,000 bonus)', 50, true)
on conflict (code) do update set name = excluded.name, credits = excluded.credits,
  price_cents = excluded.price_cents, blurb = excluded.blurb, sort_order = excluded.sort_order, active = true;

-- 2. Sign-up bonus: 100 credits for new accounts (existing wallets unchanged).
update public.app_settings set value = jsonb_build_object('signup_credits', 100) where key = 'signup_credits';

-- 3. Hide subscription plans until monthly billing is live.
update public.billing_plans set active = false;

-- 4. Partner revenue uses the real per-job provider cost recorded at submission
--    (per second and resolution), never the old flat per-job figure.
create or replace function public.settle_generation_revenue(p_generation_request_id uuid)
returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare
  g public.generation_requests;
  r public.model_cost_rules;
  v_rate numeric;
  v_gross integer;
  v_provider numeric;
  v_cost integer;
begin
  select * into g from public.generation_requests where id = p_generation_request_id;
  if not found then return null; end if;

  select * into r from public.model_cost_rules
   where provider = g.provider and model = g.model and operation = g.operation
   limit 1;

  v_provider := greatest(coalesce(g.provider_cost_cents, 0), coalesce(r.provider_cost_cents, 0));
  v_cost := ceil(
    v_provider
    + coalesce(r.fixed_overhead_cents, 0)
    + v_provider * coalesce(r.variable_overhead_percent, 0) / 100.0
  )::integer;

  select net_cents_per_credit into v_rate from public.credit_wallets where user_id = g.user_id;
  v_gross := round(coalesce(v_rate, 0) * coalesce(g.credits_reserved, 0))::integer;

  update public.generation_requests set provider_cost_cents = v_cost where id = g.id;

  return public.record_revenue('generation', g.id::text, g.user_id, v_gross, v_cost, 0, 0);
end;
$function$;
