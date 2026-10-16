-- Lower-cost music videos, same realism:
--   1. Every scene starts as a still the user approves before paying for video.
--   2. Sung scenes become one-step performances (still + song slice, lip sync
--      built in) instead of a clip plus a separate lip-sync pass.
-- Subscriber pricing is applied in code (lib/billing/plan-pricing.js) on top
-- of these rules; every rule keeps the standard 65% list margin.

-- The scene's still (first frame) and whether the user approved it.
alter table public.scenes add column if not exists keyframe_url text;
alter table public.scenes add column if not exists keyframe_approved boolean not null default false;
alter table public.scenes add column if not exists keyframe_at timestamptz;

-- Photoreal still for scenes without a real face: $0.015 per image
-- (https://muapi.ai/playground/flux-krea-dev, checked 2026-10-16).
insert into public.model_cost_rules (
  provider, model, operation, provider_cost_cents,
  target_margin_percent, payment_fee_percent, payment_fee_fixed_cents,
  fixed_overhead_cents, variable_overhead_percent, minimum_customer_price_cents,
  max_duration_seconds, max_references, max_resolution, customer_visible, customer_label, active
) values (
  'muapi', 'flux-krea-dev', 'image', 1.5,
  65, 3.5, 0.3, 0.25, 5, 2,
  null, 0, null, false, 'Scene still', true
)
on conflict (provider, model, operation) do nothing;

-- Real-face still (identity-preserving edit + face check). Billed in code by
-- resolution: 7 cents at 720p, 10 cents at 1080p (this row is the floor).
insert into public.model_cost_rules (
  provider, model, operation, provider_cost_cents,
  target_margin_percent, payment_fee_percent, payment_fee_fixed_cents,
  fixed_overhead_cents, variable_overhead_percent, minimum_customer_price_cents,
  max_duration_seconds, max_references, max_resolution, customer_visible, customer_label, active
) values (
  'muapi', 'nano-banana-2-edit', 'image', 7,
  65, 3.5, 0.3, 0.25, 5, 2,
  null, 1, null, false, 'Real-face still', true
)
on conflict (provider, model, operation) do nothing;

-- One-step sung performance: $0.045/s at 720p, $0.06/s at 1080p of audio,
-- 5 s minimum (https://muapi.ai/playground/omnihuman-1-5, checked 2026-10-16).
-- Billed per second in code; this row is the 5-second 720p floor.
insert into public.model_cost_rules (
  provider, model, operation, provider_cost_cents,
  target_margin_percent, payment_fee_percent, payment_fee_fixed_cents,
  fixed_overhead_cents, variable_overhead_percent, minimum_customer_price_cents,
  max_duration_seconds, max_references, max_resolution, customer_visible, customer_label, active
) values (
  'muapi', 'omnihuman-1-5', 'video', 22.5,
  65, 3.5, 0.3, 0.25, 5, 2,
  60, 1, null, false, 'Sung performance', true
)
on conflict (provider, model, operation) do nothing;
