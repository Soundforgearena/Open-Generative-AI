-- Applied to production as version 20260902190325 (cinexvideo_margin_floor_pricing).
-- Content exported verbatim from supabase_migrations.schema_migrations.

alter table public.model_cost_rules add column if not exists fixed_overhead_cents numeric(12,4) not null default 0; alter table public.model_cost_rules add column if not exists variable_overhead_percent numeric(5,2) not null default 0; alter table public.model_cost_rules add column if not exists payment_fee_percent numeric(5,2) not null default 0; alter table public.model_cost_rules add column if not exists payment_fee_fixed_cents numeric(12,4) not null default 0; alter table public.model_cost_rules add column if not exists minimum_customer_price_cents numeric(12,4) not null default 1; alter table public.model_cost_rules add column if not exists max_duration_seconds integer; alter table public.model_cost_rules add column if not exists max_resolution text; alter table public.model_cost_rules add column if not exists max_references integer;

create or replace function public.calculate_customer_price(p_provider_cost_cents numeric, p_margin_percent numeric default 45, p_fixed_overhead_cents numeric default 0, p_variable_overhead_percent numeric default 0, p_payment_fee_percent numeric default 0, p_payment_fee_fixed_cents numeric default 0, p_minimum_price_cents numeric default 1)
returns numeric language sql immutable as $$ select greatest(p_minimum_price_cents, round((p_provider_cost_cents + p_fixed_overhead_cents + p_payment_fee_fixed_cents) / greatest(0.01, 1 - p_margin_percent / 100.0 - p_variable_overhead_percent / 100.0 - p_payment_fee_percent / 100.0), 2)); $$;

create or replace function public.quote_generation(p_provider text, p_model text, p_operation text, p_provider_cost_cents numeric, p_duration_seconds integer default 1, p_resolution text default null, p_reference_count integer default 0)
returns table(approved boolean, customer_price_cents numeric, credits integer, projected_margin_percent numeric, reason text)
language plpgsql security definer set search_path=public as $$
declare r public.model_cost_rules; computed_price numeric; total_cost numeric; margin numeric; begin
 select * into r from public.model_cost_rules where provider=p_provider and model=p_model and operation=p_operation and active=true limit 1;
 if not found then return query select false, null::numeric, null::integer, null::numeric, 'No active pricing rule for this provider/model/operation'; return; end if;
 if r.max_duration_seconds is not null and p_duration_seconds > r.max_duration_seconds then return query select false, null::numeric, null::integer, null::numeric, 'Requested duration exceeds the configured limit'; return; end if;
 if r.max_resolution is not null and coalesce(p_resolution,'') <> r.max_resolution then return query select false, null::numeric, null::integer, null::numeric, 'Requested resolution is not enabled for this pricing rule'; return; end if;
 if r.max_references is not null and p_reference_count > r.max_references then return query select false, null::numeric, null::integer, null::numeric, 'Too many reference assets for this pricing rule'; return; end if;
 total_cost := p_provider_cost_cents + r.fixed_overhead_cents + (p_provider_cost_cents * r.variable_overhead_percent / 100.0);
 computed_price := greatest(r.minimum_customer_price_cents, round((total_cost + r.payment_fee_fixed_cents) / greatest(0.01, 1 - r.target_margin_percent / 100.0 - r.payment_fee_percent / 100.0), 2));
 margin := round(((computed_price - total_cost - r.payment_fee_fixed_cents - computed_price * r.payment_fee_percent / 100.0) / greatest(0.01, computed_price)) * 100.0, 2);
 if margin < r.target_margin_percent then return query select false, computed_price, ceil(computed_price)::integer, margin, 'Quote rejected because projected margin is below the floor'; return; end if;
 return query select true, computed_price, greatest(1,ceil(computed_price))::integer, margin, 'Approved';
end; $$;

update public.model_cost_rules set fixed_overhead_cents=0.25, variable_overhead_percent=5, payment_fee_percent=3.5, payment_fee_fixed_cents=0.30, minimum_customer_price_cents=2 where provider='muapi';

update public.model_cost_rules set max_duration_seconds=10 where operation='video';
update public.model_cost_rules set max_references=4 where operation in ('image','video');
