-- Applied to production as version 20260902190946 (cinexvideo_private_margin_quote_controls).
-- Content exported verbatim from supabase_migrations.schema_migrations.

alter table public.model_cost_rules add column if not exists customer_label text; alter table public.model_cost_rules add column if not exists customer_visible boolean not null default true;

update public.model_cost_rules set customer_label = case operation when 'image' then 'Image generation' when 'video' then 'Cinematic video' when 'audio' then 'Audio generation' when 'edit' then 'Video editing' when 'upscale' then 'Video enhancement' when 'watermark' then 'Export processing' else 'Creative generation' end where customer_label is null;

create or replace function public.customer_quote(p_provider text, p_model text, p_operation text, p_provider_cost_cents numeric, p_duration_seconds integer default 1, p_resolution text default null, p_reference_count integer default 0)
returns table(approved boolean, customer_price_cents numeric, credits integer, customer_label text, reason_code text)
language plpgsql security definer set search_path=public as $$
declare r public.model_cost_rules; computed_price numeric; total_cost numeric; margin numeric; begin
 select * into r from public.model_cost_rules where provider=p_provider and model=p_model and operation=p_operation and active=true and customer_visible=true limit 1;
 if not found then return query select false, null::numeric, null::integer, 'Creative generation'::text, 'UNAVAILABLE'; return; end if;
 if r.max_duration_seconds is not null and p_duration_seconds > r.max_duration_seconds then return query select false, null::numeric, null::integer, r.customer_label, 'LIMIT_EXCEEDED'; return; end if;
 if r.max_resolution is not null and coalesce(p_resolution,'') <> r.max_resolution then return query select false, null::numeric, null::integer, r.customer_label, 'OPTION_UNAVAILABLE'; return; end if;
 if r.max_references is not null and p_reference_count > r.max_references then return query select false, null::numeric, null::integer, r.customer_label, 'LIMIT_EXCEEDED'; return; end if;
 total_cost := p_provider_cost_cents + r.fixed_overhead_cents + (p_provider_cost_cents * r.variable_overhead_percent / 100.0);
 computed_price := greatest(r.minimum_customer_price_cents, round((total_cost + r.payment_fee_fixed_cents) / greatest(0.01, 1 - r.target_margin_percent / 100.0 - r.payment_fee_percent / 100.0), 2));
 margin := round(((computed_price - total_cost - r.payment_fee_fixed_cents - computed_price * r.payment_fee_percent / 100.0) / greatest(0.01, computed_price)) * 100.0, 2);
 if margin < r.target_margin_percent then return query select false, null::numeric, null::integer, r.customer_label, 'TEMPORARILY_UNAVAILABLE'; return; end if;
 return query select true, computed_price, greatest(1,ceil(computed_price))::integer, r.customer_label, 'APPROVED';
end; $$;

revoke all on function public.customer_quote(text,text,text,numeric,integer,text,integer) from public;
grant execute on function public.customer_quote(text,text,text,numeric,integer,text,integer) to service_role;

create or replace view public.customer_visible_plans as select code,name,monthly_price_cents,included_credits,overage_price_cents from public.billing_plans where active=true;
revoke all on public.customer_visible_plans from public;
grant select on public.customer_visible_plans to authenticated;

create or replace view public.customer_visible_operations as select distinct operation, min(customer_label) as customer_label from public.model_cost_rules where active=true and customer_visible=true group by operation;
revoke all on public.customer_visible_operations from public;
grant select on public.customer_visible_operations to authenticated;
