-- Applied to production as version 20261019182714 (final_cut).
-- Content exported verbatim from supabase_migrations.schema_migrations.

alter table public.projects add column if not exists final_cut jsonb;

alter table public.media_objects drop constraint if exists media_objects_kind_check;
alter table public.media_objects add constraint media_objects_kind_check check (kind in ('take', 'still', 'final'));

create or replace view public.media_orphans
with (security_invoker = true) as
select m.*
from public.media_objects m
where not exists (
    select 1 from public.scene_versions v where v.output_url = 'media:r2/' || m.object_key
  )
  and not exists (
    select 1 from public.scenes s where s.keyframe_url = 'media:r2/' || m.object_key
  )
  and not exists (
    select 1 from public.projects p where p.final_cut->>'ref' = 'media:r2/' || m.object_key
  );

revoke all on public.media_orphans from anon, authenticated;
