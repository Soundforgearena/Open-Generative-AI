-- Indexes for the hot paths under load.
create index if not exists credit_ledger_user_idx on public.credit_ledger (user_id, created_at desc);
create index if not exists payment_records_user_idx on public.payment_records (user_id, created_at desc);
-- Active generations per project (studio refresh resume) and for reconciliation.
create index if not exists generation_requests_project_active_idx
  on public.generation_requests (project_id, created_at)
  where status in ('queued', 'running');
create index if not exists generation_requests_status_idx on public.generation_requests (status, created_at);

-- Storage protection: how many bytes of reference uploads a user holds.
-- Used to enforce a per-user quota before any new upload is allowed.
create or replace function public.storage_used_bytes(p_user_id uuid)
returns bigint
language sql
stable
security definer
set search_path = public, storage
as $$
  select coalesce(sum((metadata->>'size')::bigint), 0)::bigint
    from storage.objects
   where bucket_id = 'cinexvideo-references'
     and name like p_user_id::text || '/%';
$$;
revoke all on function public.storage_used_bytes(uuid) from public, anon, authenticated;
grant execute on function public.storage_used_bytes(uuid) to service_role;
