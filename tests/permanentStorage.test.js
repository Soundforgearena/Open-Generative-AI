import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { archiveMedia, mediaKey, resolveMedia, isMediaRef, VIEW_TTL_SECONDS, PROVIDER_TTL_SECONDS } from '../lib/storage/media.js';
import { archiveTake, archiveStill, sweepMedia, _test } from '../lib/storage/archive.js';

const env = {
  STORAGE_S3_ENDPOINT: 'https://acct.r2.cloudflarestorage.com',
  STORAGE_S3_BUCKET: 'cinexvideo-media',
  STORAGE_S3_ACCESS_KEY_ID: 'AKID',
  STORAGE_S3_SECRET_ACCESS_KEY: 'SECRET',
};
const VIDEO = Buffer.alloc(4096, 7);

function fakeFetch({ type = 'video/mp4', status = 200, body = VIDEO, headLen } = {}) {
  const calls = [];
  const impl = async (url, opts = {}) => {
    const method = opts.method || 'GET';
    calls.push({ url: String(url), method });
    if (String(url).includes('r2.cloudflarestorage.com')) {
      if (method === 'PUT') return new Response(null, { status: 200 });
      if (method === 'HEAD') return new Response(null, { status: 200, headers: { 'content-length': String(headLen ?? body.length) } });
    }
    return new Response(status === 200 ? body : null, { status, headers: { 'content-type': type, 'content-length': String(body.length) } });
  };
  return { impl, calls };
}

test('plan TTLs: 15 minutes to view, 1 hour for models and renderer', () => {
  assert.equal(VIEW_TTL_SECONDS, 900);
  assert.equal(PROVIDER_TTL_SECONDS, 3600);
});

test('keys keep each user in their own folder', () => {
  assert.equal(mediaKey({ kind: 'takes', ownerId: 'u1', projectId: 'p1', sceneId: 's1', name: 'v1' }), 'takes/u1/p1/s1/v1');
  assert.equal(mediaKey({ kind: 'stills', ownerId: '../x', projectId: 'p1', sceneId: 's1', name: 'k' }), 'stills/unknown/p1/s1/k');
});

test('copies, verifies with HEAD, and checksums', async () => {
  const f = fakeFetch();
  const r = await archiveMedia('https://cdn.muapi.ai/outputs/a.mp4', 'takes/u/p/s/v', { fetchImpl: f.impl, env });
  assert.equal(r.ok, true);
  assert.equal(r.ref, 'media:r2/takes/u/p/s/v.mp4');
  assert.equal(r.bytes, VIDEO.length);
  assert.match(r.sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(f.calls.map((c) => c.method), ['GET', 'PUT', 'HEAD']);
});

test('refuses unverified uploads, wrong types, non-https and missing storage', async () => {
  assert.equal((await archiveMedia('https://cdn.muapi.ai/a.mp4', 'k', { fetchImpl: fakeFetch({ headLen: 1 }).impl, env })).reason, 'verify_failed');
  assert.equal((await archiveMedia('https://cdn.muapi.ai/a', 'k', { fetchImpl: fakeFetch({ type: 'text/html' }).impl, env })).reason, 'bad_type');
  assert.equal((await archiveMedia('http://cdn.muapi.ai/a.mp4', 'k', { fetchImpl: fakeFetch().impl, env })).reason, 'bad_url');
  assert.equal((await archiveMedia('https://cdn.muapi.ai/a.mp4', 'k', { fetchImpl: fakeFetch({ status: 404 }).impl, env })).reason, 'gone');
  assert.equal((await archiveMedia('https://cdn.muapi.ai/a.mp4', 'k', { fetchImpl: fakeFetch().impl, env: {} })).reason, 'storage_off');
  assert.equal((await archiveMedia('https://cdn.muapi.ai/a.mp4', 'k', { fetchImpl: fakeFetch().impl, env, maxBytes: 100 })).reason, 'too_large');
});

test('references become signed links; provider URLs pass through', () => {
  const signed = resolveMedia('media:r2/takes/u/p/s/v.mp4', { env });
  assert.match(signed, /^https:\/\/acct\.r2\.cloudflarestorage\.com\/cinexvideo-media\/takes\/u\/p\/s\/v\.mp4\?/);
  assert.match(signed, /X-Amz-Expires=900/);
  assert.equal(resolveMedia('https://cdn.muapi.ai/x.mp4', { env }), 'https://cdn.muapi.ai/x.mp4');
  assert.equal(resolveMedia('media:r2/x.mp4', { env: {} }), null);
  assert.equal(isMediaRef('media:r2/a'), true);
});

function fakeDb({ insertOk = true } = {}) {
  const log = { inserts: [], updates: [] };
  return {
    log,
    env,
    fetchImpl: fakeFetch().impl,
    selectOne: async (table, f) => (table === 'scenes' ? { id: f.id.slice(3), project_id: 'p1' } : { id: 'p1', owner_id: 'owner1' }),
    selectRows: async (table) => (table === 'scene_versions'
      ? [{ id: 'v1', scene_id: 's1', version: 1, status: 'completed', output_url: 'https://cdn.muapi.ai/sweep.mp4' }]
      : []),
    insertRows: async (table, row) => { log.inserts.push([table, row]); return { ok: insertOk }; },
    updateRows: async (table, filters, patch) => { log.updates.push([table, filters, patch]); return { ok: true, data: [] }; },
  };
}

test('a take is registered before its row switches, and only if unchanged', async () => {
  const db = fakeDb();
  const r = await archiveTake({ id: 'v1', scene_id: 's1', status: 'completed', output_url: 'https://cdn.muapi.ai/t.mp4' }, db);
  assert.equal(r.ok, true);
  const [table, row] = db.log.inserts[0];
  assert.equal(table, 'media_objects');
  assert.equal(row.owner_id, 'owner1');
  assert.equal(row.object_key, 'takes/owner1/p1/s1/v1.mp4');
  assert.equal(row.source_url, 'https://cdn.muapi.ai/t.mp4');
  assert.deepEqual(db.log.updates[0], ['scene_versions', { id: 'eq.v1', output_url: 'eq.https://cdn.muapi.ai/t.mp4' }, { output_url: 'media:r2/takes/owner1/p1/s1/v1.mp4' }]);
});

test('if the register write fails, the row keeps its provider URL', async () => {
  const db = fakeDb({ insertOk: false });
  const r = await archiveStill({ id: 's1', keyframe_url: 'https://cdn.muapi.ai/k.jpg' }, db);
  assert.equal(r.reason, 'metadata_failed');
  assert.equal(db.log.updates.length, 0);
});

test('sweep copies leftovers and never deletes', async () => {
  const db = fakeDb();
  const s = await sweepMedia(db);
  assert.equal(s.archived, 1);
  assert.equal(s.pending, 1);
  assert.equal((await sweepMedia({ ...db, env: {} })).storage, 'off');
  const src = readFileSync(new URL('../lib/storage/archive.js', import.meta.url), 'utf8');
  assert.ok(!/deleteMedia|method: 'DELETE'/.test(src));
});

test('failed copies back off; files the provider lost are not retried', () => {
  _test.noteFailure('https://x/a.mp4', 'gone');
  assert.equal(_test.shouldTry('https://x/a.mp4'), false);
  _test.noteFailure('https://x/b.mp4', 'timeout', 0);
  assert.equal(_test.shouldTry('https://x/b.mp4', 60_000), false);
  assert.equal(_test.shouldTry('https://x/b.mp4', 3 * 60_000), true);
});

test('every reader signs stored media; nothing signed is written to the database', () => {
  const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
  assert.match(read('../app/api/projects/[id]/route.js'), /keyframe_url: resolveMedia\(scene\.keyframe_url\)/);
  assert.match(read('../app/api/generate/route.js'), /resolveMedia\(fromStill\.keyframe_url, \{ expiresIn: PROVIDER_TTL_SECONDS \}\)/);
  assert.match(read('../app/api/generate/route.js'), /resolveMedia\(lipSync\.source\.output_url/);
  assert.match(read('../app/api/exports/video/route.js'), /resolveMedia\(t\.url, \{ expiresIn: PROVIDER_TTL_SECONDS \}\)/);
  assert.match(read('../app/api/jobs/[requestId]/route.js'), /archiveSoon\('take'/);
  assert.match(read('../lib/generation/still-job.js'), /archiveSoon\('still'/);
  assert.match(read('../app/api/admin/cron/reconcile/route.js'), /sweepMedia\(/);
  const mig = read('../supabase/migrations/20261018190000_media_objects.sql');
  assert.match(mig, /enable row level security/);
  assert.match(mig, /create or replace view public\.media_orphans/);
  assert.ok(!/drop |delete from|alter table public\.(scenes|scene_versions)/i.test(mig));
});
