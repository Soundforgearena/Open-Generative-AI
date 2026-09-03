-- CinexVideo creative production schema
-- Adds the project / scene / asset / generation tables the application needs to
-- persist real work, plus credit settlement and a private references bucket.

-- ---------------------------------------------------------------- projects
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  lane text not null check (lane in ('music_video','episode')),
  title text not null default 'Untitled project',
  logline text,
  visual_identity jsonb not null default '{}'::jsonb,
  director_plan jsonb,
  status text not null default 'draft' check (status in ('draft','in_production','delivered','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists projects_owner_idx on public.projects(owner_id, updated_at desc);

-- ------------------------------------------------------------------ scenes
create table if not exists public.scenes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  position integer not null default 1,
  title text not null default 'Untitled scene',
  purpose text,
  duration_seconds integer not null default 8 check (duration_seconds between 1 and 600),
  shot_direction text,
  prompt text,
  status text not null default 'draft' check (status in ('draft','generating','needs_review','approved','failed')),
  continuity_locked boolean not null default false,
  active_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, position)
);
create index if not exists scenes_project_idx on public.scenes(project_id, position);

-- ---------------------------------------------------------- scene versions
create table if not exists public.scene_versions (
  id uuid primary key default gen_random_uuid(),
  scene_id uuid not null references public.scenes(id) on delete cascade,
  version integer not null,
  prompt text,
  output_url text,
  thumbnail_url text,
  status text not null default 'pending' check (status in ('pending','completed','failed')),
  approved boolean not null default false,
  created_at timestamptz not null default now(),
  unique (scene_id, version)
);
create index if not exists scene_versions_scene_idx on public.scene_versions(scene_id, version desc);

-- ---------------------------------------------------------- project assets
create table if not exists public.project_assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  kind text not null check (kind in ('character','outfit','location','prop','reference','audio')),
  name text not null,
  notes text,
  storage_path text,
  scene_range text,
  locked boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists project_assets_project_idx on public.project_assets(project_id, kind);

-- ----------------------------------------------------- generation requests
create table if not exists public.generation_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  scene_id uuid references public.scenes(id) on delete set null,
  scene_version integer,
  provider text not null default 'muapi',
  model text not null,
  operation text not null default 'video',
  provider_request_id text,
  reservation_reference text,
  credits_reserved integer not null default 0,
  status text not null default 'queued' check (status in ('queued','running','completed','failed','released')),
  output jsonb,
  error_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists generation_requests_user_idx on public.generation_requests(user_id, created_at desc);
create index if not exists generation_requests_provider_idx on public.generation_requests(provider_request_id);

-- --------------------------------------------------------- updated_at glue
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;

do $$
declare t text;
begin
  foreach t in array array['projects','scenes','generation_requests'] loop
    execute format('drop trigger if exists touch_%1$s on public.%1$s', t);
    execute format('create trigger touch_%1$s before update on public.%1$s for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;

-- ------------------------------------------------------------------- RLS
alter table public.projects enable row level security;
alter table public.scenes enable row level security;
alter table public.scene_versions enable row level security;
alter table public.project_assets enable row level security;
alter table public.generation_requests enable row level security;

drop policy if exists projects_owner on public.projects;
create policy projects_owner on public.projects
  for all using (owner_id = auth.uid() or public.is_cinex_admin(auth.uid()))
  with check (owner_id = auth.uid() or public.is_cinex_admin(auth.uid()));

drop policy if exists scenes_owner on public.scenes;
create policy scenes_owner on public.scenes
  for all using (exists (select 1 from public.projects p where p.id = scenes.project_id
    and (p.owner_id = auth.uid() or public.is_cinex_admin(auth.uid()))))
  with check (exists (select 1 from public.projects p where p.id = scenes.project_id
    and (p.owner_id = auth.uid() or public.is_cinex_admin(auth.uid()))));

drop policy if exists scene_versions_owner on public.scene_versions;
create policy scene_versions_owner on public.scene_versions
  for all using (exists (select 1 from public.scenes s join public.projects p on p.id = s.project_id
    where s.id = scene_versions.scene_id
    and (p.owner_id = auth.uid() or public.is_cinex_admin(auth.uid()))))
  with check (exists (select 1 from public.scenes s join public.projects p on p.id = s.project_id
    where s.id = scene_versions.scene_id
    and (p.owner_id = auth.uid() or public.is_cinex_admin(auth.uid()))));

drop policy if exists project_assets_owner on public.project_assets;
create policy project_assets_owner on public.project_assets
  for all using (exists (select 1 from public.projects p where p.id = project_assets.project_id
    and (p.owner_id = auth.uid() or public.is_cinex_admin(auth.uid()))))
  with check (exists (select 1 from public.projects p where p.id = project_assets.project_id
    and (p.owner_id = auth.uid() or public.is_cinex_admin(auth.uid()))));

drop policy if exists generation_requests_owner on public.generation_requests;
create policy generation_requests_owner on public.generation_requests
  for select using (user_id = auth.uid() or public.is_cinex_admin(auth.uid()));

-- ------------------------------------------------- credit settlement (gap)
-- reserve_credits already debits the wallet balance and writes a 'reservation'
-- ledger row. Consumption therefore settles the reservation and rolls the
-- lifetime_consumed counter without touching the balance a second time.
create or replace function public.consume_credits(
  p_user_id uuid, p_credits integer, p_reference_id text
) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if p_credits <= 0 then return false; end if;
  update public.credit_wallets
     set lifetime_consumed = lifetime_consumed + p_credits, updated_at = now()
   where user_id = p_user_id;
  insert into public.credit_ledger(user_id, amount, entry_type, reference_id, description)
  values (p_user_id, 0, 'consume', p_reference_id, 'Generation credits consumed');
  update public.credit_reservations set status = 'consumed'
   where user_id = p_user_id and generation_job_id::text = p_reference_id;
  return true;
end;
$$;

revoke all on function public.consume_credits(uuid, integer, text) from public, anon, authenticated;

-- ---------------------------------------------------- references bucket
insert into storage.buckets (id, name, public)
values ('cinexvideo-references', 'cinexvideo-references', false)
on conflict (id) do nothing;

drop policy if exists cinex_refs_owner on storage.objects;
create policy cinex_refs_owner on storage.objects
  for all using (bucket_id = 'cinexvideo-references' and owner = auth.uid())
  with check (bucket_id = 'cinexvideo-references' and owner = auth.uid());
