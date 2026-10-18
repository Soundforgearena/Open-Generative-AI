-- Sung scenes switch from OmniHuman 1.5 to Kling Avatar (Standard).
-- OmniHuman failed every job in production (11 of 11, "API Concurrent Limit"),
-- so it is retired. Kling Avatar takes the same inputs (approved still + the
-- scene's slice of the song) and bills $0.07 per second of audio, 5 s minimum
-- (https://muapi.ai/ai-avatar-lipsync-api, checked 2026-10-18). Code prices
-- each job per second; this row is the floor. Standard 65% list margin.

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
