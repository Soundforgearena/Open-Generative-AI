-- Applied to production as version 20261018205526 (media_objects).
-- Content exported verbatim from supabase_migrations.schema_migrations.

create table if not exists public.media_objects (
  object_key text primary key,
  storage_backend text not null default 'r2' check (storage_backend in ('r2')),
  owner_id uuid not null,
  project_id uuid,
  scene_id uuid,
  scene_version_id uuid,
  kind text not null check (kind in ('take', 'still')),
  size_bytes bigint not null check (size_bytes > 0),
  content_type text not null,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  source_url text,
  created_at timestamptz not null default now()
);

create index if not exists media_objects_owner_idx on public.media_objects (owner_id);
create index if not exists media_objects_project_idx on public.media_objects (project_id);

alter table public.media_objects enable row level security;
revoke all on public.media_objects from anon, authenticated;

create or replace view public.media_orphans
with (security_invoker = true) as
select m.*
from public.media_objects m
where not exists (
    select 1 from public.scene_versions v where v.output_url = 'media:r2/' || m.object_key
  )
  and not exists (
    select 1 from public.scenes s where s.keyframe_url = 'media:r2/' || m.object_key
  );

revoke all on public.media_orphans from anon, authenticated;
