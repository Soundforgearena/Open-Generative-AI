-- Preserve narrative purpose and dedicated audio-sync guidance separately.
alter table public.scenes
  add column if not exists audio_sync text;
