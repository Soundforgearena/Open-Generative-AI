-- Music video lip sync: exact song timing on scenes, lip-synced takes, and
-- price rules for lyric timing and lip sync. Additive only; safe to apply
-- before the code that uses it is deployed.

-- Each scene can map to an exact window of the uploaded song.
alter table public.scenes add column if not exists start_ms integer;
alter table public.scenes add column if not exists end_ms integer;
alter table public.scenes add column if not exists lyric_text text;
alter table public.scenes add column if not exists vocalist text;
alter table public.scenes add column if not exists lip_sync boolean not null default false;

do $$ begin
  alter table public.scenes add constraint scenes_song_window_check
    check (
      (start_ms is null and end_ms is null)
      or (start_ms >= 0 and end_ms > start_ms and end_ms - start_ms <= 600000)
    );
exception when duplicate_object then null; end $$;

-- A take is either a generated clip or a lip-synced version of another take.
alter table public.scene_versions add column if not exists kind text not null default 'video';
alter table public.scene_versions add column if not exists source_version_id uuid references public.scene_versions(id) on delete set null;
do $$ begin
  alter table public.scene_versions add constraint scene_versions_kind_check
    check (kind in ('video', 'lip_sync'));
exception when duplicate_object then null; end $$;

-- Allow the new priced operations.
alter table public.model_cost_rules drop constraint if exists model_cost_rules_operation_check;
alter table public.model_cost_rules add constraint model_cost_rules_operation_check
  check (operation = any (array['image', 'video', 'audio', 'edit', 'upscale', 'watermark', 'lip_sync', 'alignment']));

-- Lip sync: provider cost is per second of audio (the code multiplies by
-- the song slice length). Same margin settings as the video model.
insert into public.model_cost_rules (
  provider, model, operation, provider_cost_cents, customer_price_cents,
  target_margin_percent, payment_fee_percent, payment_fee_fixed_cents,
  fixed_overhead_cents, variable_overhead_percent, minimum_customer_price_cents,
  max_duration_seconds, max_references, max_resolution, customer_visible, customer_label, active
) values (
  'muapi', 'volcengine-video-to-video-lip-sync', 'lip_sync', 6, round(6 / 0.35, 4),
  65, 3.5, 0.3, 0.25, 5, 2,
  10, 2, null, true, 'Lip sync', true
)
on conflict (provider, model, operation) do nothing;

-- Lyric timing: provider cost is per started minute of audio.
insert into public.model_cost_rules (
  provider, model, operation, provider_cost_cents, customer_price_cents,
  target_margin_percent, payment_fee_percent, payment_fee_fixed_cents,
  fixed_overhead_cents, variable_overhead_percent, minimum_customer_price_cents,
  max_duration_seconds, max_references, max_resolution, customer_visible, customer_label, active
) values (
  'openai', 'whisper-1', 'alignment', 0.6, round(0.6 / 0.35, 4),
  65, 3.5, 0.3, 0.25, 5, 2,
  null, 0, null, false, 'Lyric timing', true
)
on conflict (provider, model, operation) do nothing;
