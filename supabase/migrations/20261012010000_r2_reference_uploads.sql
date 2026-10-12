-- Additive metadata only. Existing Supabase objects are not copied or deleted.
alter table public.project_assets
  add column if not exists storage_backend text not null default 'supabase',
  add column if not exists size_bytes bigint,
  add column if not exists content_type text,
  add column if not exists upload_state text not null default 'ready';

-- Keep metadata and object cleanup inseparable. Browser clients must use the
-- authenticated app routes, not forge ready assets or bypass storage quotas.
revoke insert, update, delete on public.project_assets from public, anon, authenticated;
grant select, insert, update, delete on public.project_assets to service_role;
-- A raw project DELETE would cascade metadata while orphaning private media.
-- The application's existing archive flow uses UPDATE and is unaffected.
revoke delete on public.projects from public, anon, authenticated;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'project_assets_storage_backend_check') then
    alter table public.project_assets add constraint project_assets_storage_backend_check
      check (storage_backend in ('supabase', 'r2'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'project_assets_upload_state_check') then
    alter table public.project_assets add constraint project_assets_upload_state_check
      check (upload_state in ('pending', 'uploading', 'ready', 'deleting'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'project_assets_size_bytes_check') then
    alter table public.project_assets add constraint project_assets_size_bytes_check
      check (size_bytes is null or size_bytes > 0);
  end if;
end; $$;

-- Serialize reservations per media owner so parallel uploads cannot bypass
-- file-count or byte quotas. Pending uploads count against both limits.
create or replace function public.reserve_r2_reference_upload(
  p_asset_id uuid, p_project_id uuid, p_owner_id uuid,
  p_kind text, p_name text, p_notes text, p_path text,
  p_size_bytes bigint, p_content_type text,
  p_quota_bytes bigint, p_admin boolean default false
) returns public.project_assets
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_used bigint;
  v_asset public.project_assets;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text, 7328));
  if not exists (select 1 from public.projects where id=p_project_id and owner_id=p_owner_id) then
    raise exception 'PROJECT_NOT_FOUND';
  end if;
  if p_kind is null or p_kind not in ('character','outfit','location','prop','reference','audio')
     or p_size_bytes is null or p_size_bytes < 1
     or p_size_bytes > (case when p_kind='audio' then 62914560 else 15728640 end)
     or p_path is null
     or p_path not like ('r2://%/refs/' || p_owner_id::text || '/' || p_project_id::text || '/' || p_asset_id::text) then
    raise exception 'INVALID_UPLOAD';
  end if;
  if (select count(*) from public.project_assets where project_id=p_project_id) >= 30 then
    raise exception 'PROJECT_FILE_LIMIT';
  end if;
  if not p_admin then
    select coalesce(sum(a.size_bytes),0) into v_used
      from public.project_assets a join public.projects p on p.id=a.project_id
      where p.owner_id=p_owner_id and a.storage_backend='r2';
    v_used := v_used + public.storage_used_bytes(p_owner_id);
    if p_quota_bytes is null or p_quota_bytes < 1 or v_used + p_size_bytes > p_quota_bytes then
      raise exception 'STORAGE_QUOTA_EXCEEDED';
    end if;
  end if;
  insert into public.project_assets(id,project_id,kind,name,notes,storage_path,storage_backend,size_bytes,content_type,upload_state)
    values (p_asset_id,p_project_id,p_kind,p_name,p_notes,p_path,'r2',p_size_bytes,p_content_type,'pending')
    returning * into v_asset;
  return v_asset;
end; $$;
revoke all on function public.reserve_r2_reference_upload(uuid,uuid,uuid,text,text,text,text,bigint,text,bigint,boolean) from public, anon, authenticated;
grant execute on function public.reserve_r2_reference_upload(uuid,uuid,uuid,text,text,text,text,bigint,text,bigint,boolean) to service_role;
