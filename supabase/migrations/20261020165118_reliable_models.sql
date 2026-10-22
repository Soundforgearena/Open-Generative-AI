-- Applied to production as version 20261020165118 (reliable_models).
-- Content exported verbatim from supabase_migrations.schema_migrations.

insert into public.model_cost_rules (
  provider, model, operation, provider_cost_cents,
  target_margin_percent, payment_fee_percent, payment_fee_fixed_cents,
  fixed_overhead_cents, variable_overhead_percent, minimum_customer_price_cents,
  max_duration_seconds, max_references, max_resolution, customer_visible, customer_label, active
) values
  ('muapi', 'seedance-v1.5-pro-i2v-fast', 'video', 13,
   65, 3.5, 0.3, 0.25, 5, 2,
   12, 1, null, false, 'Real-face video', true),
  ('muapi', 'veed-lipsync', 'lip_sync', 3,
   65, 3.5, 0.3, 0.25, 5, 2,
   10, 2, null, true, 'Lip sync', true)
on conflict (provider, model, operation) do update set active = true;

update public.model_cost_rules
set active = false
where provider = 'muapi' and model = 'volcengine-video-to-video-lip-sync' and operation = 'lip_sync';
