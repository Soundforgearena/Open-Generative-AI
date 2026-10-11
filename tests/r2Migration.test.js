import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('R2 reservation migration enforces quota, ownership, state and server-only writes', async () => {
  const db = new PGlite();
  const owner = '00000000-0000-4000-8000-000000000001';
  const project = '00000000-0000-4000-8000-000000000002';
  const id = '00000000-0000-4000-8000-000000000003';
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create table public.projects(id uuid primary key,owner_id uuid);
      create table public.project_assets(
        id uuid primary key default gen_random_uuid(),project_id uuid references projects(id) on delete cascade,
        kind text,name text,notes text,storage_path text,created_at timestamptz default now()
      );
      grant all on public.projects,public.project_assets to authenticated;
      create function public.storage_used_bytes(uuid) returns bigint language sql as $$ select 5::bigint $$;
      insert into projects values ('${project}','${owner}');
    `);
    const sql = await readFile(new URL('../supabase/migrations/20261012010000_r2_reference_uploads.sql', import.meta.url), 'utf8');
    await db.exec(sql); await db.exec(sql);
    const reserve = (assetId, size, quota, actualOwner = owner) => db.query(
      'select * from reserve_r2_reference_upload($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
      [assetId, project, actualOwner, 'reference', 'test', null, `r2://cinexvideo-vault/refs/${actualOwner}/${project}/${assetId}`, size, 'image/png', quota, false],
    );
    const result = await reserve(id, 10, 20);
    assert.equal(result.rows[0].upload_state, 'pending');
    assert.equal(result.rows[0].storage_backend, 'r2');
    await assert.rejects(reserve('00000000-0000-4000-8000-000000000004', 10, 20), /STORAGE_QUOTA_EXCEEDED/);
    await assert.rejects(reserve('00000000-0000-4000-8000-000000000004', 1, 100, '00000000-0000-4000-8000-000000000009'), /PROJECT_NOT_FOUND/);
    await assert.rejects(reserve('00000000-0000-4000-8000-000000000004', 15728641, 20000000), /INVALID_UPLOAD/);
    await assert.rejects(db.exec("update project_assets set upload_state='bogus'"), (e) => e.code === '23514');
    await db.exec(`insert into project_assets(project_id,kind,name) select '${project}','reference','legacy' from generate_series(1,29)`);
    await assert.rejects(reserve('00000000-0000-4000-8000-000000000004', 1, 100), /PROJECT_FILE_LIMIT/);
    await db.exec('set role authenticated');
    await assert.rejects(db.exec("update project_assets set upload_state='ready'"), (e) => e.code === '42501');
    await assert.rejects(db.exec("delete from project_assets"), (e) => e.code === '42501');
    await assert.rejects(db.exec("delete from projects"), (e) => e.code === '42501');
    await assert.rejects(reserve('00000000-0000-4000-8000-000000000004', 1, 100), (e) => e.code === '42501');
    await db.exec('reset role');
  } finally { await db.close(); }
});
