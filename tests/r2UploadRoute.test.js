import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { exactSizeStream, parseR2Path, r2AssetPathMatches } from '../lib/storage/media-tokens.js';
import { presignUrl } from '../lib/storage/provider.js';

const id = '00000000-0000-4000-8000-000000000003';
let state;
const dependencies = {
  guard: async () => ({ user: { id: state.user }, admin: false }),
  selectOne: async (table) => table === 'projects' ? { owner_id: 'owner' } : state.asset,
  updateRows: async (_table, filter, patch) => {
    if (filter.upload_state !== `eq.${state.asset.upload_state}`) return { ok: true, data: [] };
    Object.assign(state.asset, patch); return { ok: true, data: [{ ...state.asset }] };
  },
  deleteStorageObject: async () => { state.cleanup++; return true; },
  safeError: (error, status = 400) => Response.json({ error }, { status }),
  activeR2Environment: async () => ({
    STORAGE_S3_ENDPOINT: 'https://example.r2.cloudflarestorage.com',
    STORAGE_S3_BUCKET: 'cinexvideo-vault',
    STORAGE_S3_ACCESS_KEY_ID: 'a'.repeat(32), STORAGE_S3_SECRET_ACCESS_KEY: 'b'.repeat(64),
  }),
  exactSizeStream, parseR2Path, r2AssetPathMatches, presignUrl,
  mediaReadUrl: () => '/api/storage/media?signed-read',
  rateLimit: () => null,
};
globalThis.__r2UploadDependencies = dependencies;
const source = (await readFile(new URL('../app/api/uploads/[id]/content/route.js', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '');
const module = await import(`data:text/javascript;base64,${Buffer.from(
  `const {${Object.keys(dependencies).join(',')}}=globalThis.__r2UploadDependencies;\n${source}`,
).toString('base64')}`);
function setup() {
  state = { user: 'owner', cleanup: 0, asset: {
    id, project_id: 'project', storage_backend: 'r2', upload_state: 'pending',
    storage_path: `r2://cinexvideo-vault/refs/owner/project/${id}`,
    content_type: 'image/png', size_bytes: 3,
  } };
}
const request = (body = 'abc') => new Request(`https://cinexvideo.app/api/uploads/${id}/content`, {
  method: 'PUT', headers: { 'Content-Type': 'image/png' }, body,
});

test('R2 upload streams exactly the reserved bytes before making metadata ready', async (t) => {
  setup();
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.match(url, /r2\.cloudflarestorage\.com\/cinexvideo-vault\/refs\//);
    assert.equal(options.headers['Content-Length'], '3');
    assert.equal(options.redirect, 'error');
    assert.equal(await new Response(options.body).text(), 'abc');
    assert.equal(state.asset.upload_state, 'uploading');
    return new Response(null, { status: 200 });
  });
  const response = await module.PUT(request(), { params: Promise.resolve({ id }) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).asset.upload_state, 'ready');
  assert.equal(state.cleanup, 0);
});

test('oversized R2 upload cleans up its object and keeps a retryable reservation', async (t) => {
  setup();
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    await new Response(options.body).text();
    return new Response(null, { status: 200 });
  });
  const response = await module.PUT(request('oversized'), { params: Promise.resolve({ id }) });
  assert.equal(response.status, 502);
  assert.equal(state.asset.upload_state, 'pending');
  assert.equal(state.cleanup, 1);
});

test('another user cannot upload to the reserved object', async (t) => {
  setup(); state.user = 'other-user';
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('must not call provider'); });
  assert.equal((await module.PUT(request(), { params: Promise.resolve({ id }) })).status, 404);
  assert.equal(fetch.mock.callCount(), 0);
});

test('a completed reservation cannot overwrite its original file', async (t) => {
  setup(); state.asset.upload_state = 'ready';
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('must not call provider'); });
  assert.equal((await module.PUT(request(), { params: Promise.resolve({ id }) })).status, 409);
  assert.equal(fetch.mock.callCount(), 0);
});

test('a forged cross-project storage path is rejected before uploading', async (t) => {
  setup(); state.asset.storage_path = `r2://cinexvideo-vault/refs/other-owner/project/${id}`;
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('must not call provider'); });
  assert.equal((await module.PUT(request(), { params: Promise.resolve({ id }) })).status, 409);
  assert.equal(fetch.mock.callCount(), 0);
});
