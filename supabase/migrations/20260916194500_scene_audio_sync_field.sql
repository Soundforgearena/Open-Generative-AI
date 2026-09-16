-- Persist dedicated audio-sync notes for director scenes without overloading purpose.
alter table public.scenes
  add column if not exists audio_sync text;
