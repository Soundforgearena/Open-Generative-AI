-- Dance shots: real moves copied from an uploaded dance clip onto a scene's
-- approved still (Kling 3.0 Standard Motion Control).

-- 1. Dance clips are a project asset kind.
alter table public.project_assets drop constraint if exists project_assets_kind_check;
alter table public.project_assets add constraint project_assets_kind_check
  check (kind in ('character','outfit','location','prop','reference','audio','motion'));

-- 2. A scene can use one dance clip, starting at an offset into the clip.
alter table public.scenes
  add column if not exists motion_asset_id uuid references public.project_assets(id) on delete set null,
  add column if not exists motion_start_ms integer not null default 0;
alter table public.scenes drop constraint if exists scenes_motion_start_ms_check;
alter table public.scenes add constraint scenes_motion_start_ms_check
  check (motion_start_ms >= 0 and motion_start_ms <= 600000);

-- 3. The private reference bucket accepts MP4 and MOV (size limit unchanged).
update storage.buckets
   set allowed_mime_types = (
     select array_agg(distinct m) from unnest(coalesce(allowed_mime_types, '{}') || array['video/mp4','video/quicktime']) as m
   )
 where id = 'cinexvideo-references';

-- 4. Price rule: $0.10/s (https://muapi.ai/playground/kling-v3.0-std-motion-control,
-- checked 2026-10-16). Billed per second in code; this row is the 3-second floor.
insert into public.model_cost_rules (
  provider, model, operation, provider_cost_cents,
  target_margin_percent, payment_fee_percent, payment_fee_fixed_cents,
  fixed_overhead_cents, variable_overhead_percent, minimum_customer_price_cents,
  max_duration_seconds, max_references, max_resolution, customer_visible, customer_label, active
) values (
  'muapi', 'kling-v3.0-std-motion-control', 'video', 30,
  65, 3.5, 0.3, 0.25, 5, 2,
  30, 1, null, false, 'Dance shot', true
)
on conflict (provider, model, operation) do nothing;
