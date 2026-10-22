-- Applied to production as version 20261016200639 (beat_dance).
-- Content exported verbatim from supabase_migrations.schema_migrations.

-- Beat-synced dance shots, made from the approved still plus the scene's
-- slice of the song (Seedance 2 Omni Reference Fast). No uploads needed.
-- $0.75 per clip of 4-15 s (https://muapi.ai/playground/seedance-2-omni-reference-no-video-fast,
-- checked 2026-10-16). Flat per clip, so the rule cost is the full cost.
insert into public.model_cost_rules (
  provider, model, operation, provider_cost_cents,
  target_margin_percent, payment_fee_percent, payment_fee_fixed_cents,
  fixed_overhead_cents, variable_overhead_percent, minimum_customer_price_cents,
  max_duration_seconds, max_references, max_resolution, customer_visible, customer_label, active
) values (
  'muapi', 'seedance-2-omni-reference-no-video-fast', 'video', 75,
  65, 3.5, 0.3, 0.25, 5, 2,
  15, 1, null, false, 'Beat-synced dance shot', true
)
on conflict (provider, model, operation) do nothing;
