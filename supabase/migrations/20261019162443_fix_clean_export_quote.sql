-- Applied to production as version 20261019162443 (fix_clean_export_quote).
-- Content exported verbatim from supabase_migrations.schema_migrations.

create or replace function public.customer_export_quote(p_export_type text, p_resolution text, p_format text)
returns table(approved boolean, credits integer, customer_label text, watermark_required boolean, reason_code text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r public.export_cost_rules;
  price numeric;
  total_cost numeric;
  charged integer;
  margin numeric;
begin
  select * into r from public.export_cost_rules
  where export_type = p_export_type and resolution = p_resolution and format = p_format and active = true
  limit 1;
  if not found then
    return query select false, null::integer, 'Export'::text, true, 'UNAVAILABLE';
    return;
  end if;
  if r.credits = 0 then
    return query select true, 0, r.customer_label, r.watermark_required, 'APPROVED';
    return;
  end if;
  total_cost := r.provider_cost_cents + r.fixed_overhead_cents + (r.provider_cost_cents * r.variable_overhead_percent / 100.0);
  price := greatest(r.minimum_customer_price_cents,
    ceil((total_cost + r.payment_fee_fixed_cents) / greatest(0.01, 1 - r.target_margin_percent / 100.0 - r.payment_fee_percent / 100.0)));
  charged := greatest(r.credits, price)::integer;
  margin := ((charged - total_cost - r.payment_fee_fixed_cents - charged * r.payment_fee_percent / 100.0) / greatest(0.01, charged)) * 100.0;
  if margin < r.target_margin_percent then
    return query select false, null::integer, r.customer_label, r.watermark_required, 'TEMPORARILY_UNAVAILABLE';
    return;
  end if;
  return query select true, charged, r.customer_label, r.watermark_required, 'APPROVED';
end;
$function$;
