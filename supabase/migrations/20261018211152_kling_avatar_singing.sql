-- Applied to production as version 20261018211152 (kling_avatar_singing).
-- Content exported verbatim from supabase_migrations.schema_migrations.

insert into public.model_cost_rules (
  provider, model, operation, provider_cost_cents,
  target_margin_percent, payment_fee_percent, payment_fee_fixed_cents,
  fixed_overhead_cents, variable_overhead_percent, minimum_customer_price_cents,
  max_duration_seconds, max_references, max_resolution, customer_visible, customer_label, active
) values (
  'muapi', 'kling-v1-avatar-standard', 'video', 35,
  65, 3.5, 0.3, 0.25, 5, 2,
  60, 1, null, false, 'Sung performance', true
)
on conflict (provider, model, operation) do update set active = true;

update public.model_cost_rules
set active = false
where provider = 'muapi' and model = 'omnihuman-1-5' and operation = 'video';
