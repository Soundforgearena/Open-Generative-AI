-- Most reliable MUAPI models (live leaderboard https://muapi.ai/rankings/video,
-- 7 days to 2026-10-20: completed / submitted production jobs).
--  * Animating approved stills: Seedance 1.5 Pro fast, 99.4% of 795 jobs
--    (PixVerse v6 was 87.5%). $0.026/s at 720p, $0.039/s at 1080p, 4-12 s.
--  * Lip sync on a finished take: VEED, 98.3% (Volcengine was 68.1%).
-- Code prices each job per second (lib/billing/provider-pricing.js); these
-- rows are floors. Standard 65% list margin, same fees as every other rule.

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

-- Volcengine stays priced for old jobs but is no longer offered.
update public.model_cost_rules
set active = false
where provider = 'muapi' and model = 'volcengine-video-to-video-lip-sync' and operation = 'lip_sync';
