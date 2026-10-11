import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Execute the real browser client, replacing only the Supabase SDK boundary.
// No live account, provider requests or billable operations are used.
const source = await readFile(new URL('../lib/cinexvideo-client.js', import.meta.url), 'utf8');
const client = await import(`data:text/javascript;base64,${Buffer.from(source.replace(
  "import { getSupabaseBrowserClient } from './supabase-browser';",
  'const getSupabaseBrowserClient = () => globalThis.__testSupabase;',
)).toString('base64')}`);

test('Director retry key reaches the HTTP header unchanged with the same payload', async (t) => {
  globalThis.__testSupabase = { auth: { getSession: async () => ({ data: { session: { access_token: 'test-only' } } }) } };
  t.after(() => { delete globalThis.__testSupabase; });
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, ...options });
    return Response.json({ suggestion: 'A draft' });
  });
  const request = { action: 'cinematicPrompt', fieldType: 'videoPrompt', value: 'shot', instruction: '', context: {}, idempotencyKey: 'same-logical-request' };
  await client.requestDirectorAssist(request);
  await client.requestDirectorAssist(request);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, '/api/director');
  assert.equal(calls[0].headers['Idempotency-Key'], request.idempotencyKey);
  assert.equal(calls[1].headers['Idempotency-Key'], request.idempotencyKey);
  assert.equal(calls[0].body, calls[1].body);
  assert.equal(JSON.parse(calls[0].body).field_type, 'videoPrompt');
  await client.requestDirectorAssist({ ...request, idempotencyKey: undefined });
  assert.match(calls[2].headers['Idempotency-Key'], /^[0-9a-f-]{36}$/);
});

test('missing session is a 401 and never calls a protected API', async (t) => {
  globalThis.__testSupabase = null;
  t.after(() => { delete globalThis.__testSupabase; });
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected network request'); });
  await assert.rejects(client.getAccount(), { status: 401, message: 'Please sign in to continue.' });
  assert.equal(fetch.mock.callCount(), 0);
});

test('Studio project boundary isolates mutable work and cleans up deferred saves', async () => {
  const studio = await readFile(new URL('../components/studio/Studio.js', import.meta.url), 'utf8');
  assert.match(studio, /<StudioWorkspace key=\{search\.get\('project'\) \|\| ''\} \/>/);
  assert.match(studio, /guard\.stop\(\);\s*window\.clearTimeout\(saveTimer\.current\)/);
  assert.match(studio, /selectedIdRef\.current !== quotedSceneId/);
});

test('Director snapshots retry payload and does not claim unknown failures are free', async () => {
  const director = await readFile(new URL('../components/studio/StudioDirector.js', import.meta.url), 'utf8');
  assert.match(director, /const request = retryRequest \|\| \{/);
  assert.doesNotMatch(director, /No credits were charged/);
  assert.ok(director.indexOf('actionLock.current.tryAcquire()') < director.indexOf("setError(''); setResult(null)"));
});

test('legacy writing animation cannot submit a paid request twice', async () => {
  const source = await readFile(new URL('../components/AiDirectorAssistant.js', import.meta.url), 'utf8');
  assert.match(source, /if \(!pendingAction \|\| !request \|\| submittingRef\.current\) return/);
  assert.match(source, /requestDirectorAssist\(request\)/);
  assert.match(source, /idempotencyKey: crypto\.randomUUID\(\)/);
  assert.doesNotMatch(source, /No credits were charged/);
});

test('R2 uploads attach auth only to the same-origin proxy and return confirmed metadata', async (t) => {
  globalThis.__testSupabase = { auth: { getSession: async () => ({ data: { session: { access_token: 'test-only' } } }) } };
  t.after(() => { delete globalThis.__testSupabase; });
  const id = '00000000-0000-4000-8000-000000000003';
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    if (url === '/api/uploads') return Response.json({ transport: 'r2-proxy', upload_url: `/api/uploads/${id}/content`, content_type: 'image/png', asset: { id, upload_state: 'pending' } });
    return Response.json({ asset: { id, upload_state: 'ready', preview_url: '/api/storage/media?signed' } });
  });
  const result = await client.uploadReference('project', new File(['abc'], 'photo.png', { type: 'image/png' }));
  assert.equal(result.upload_state, 'ready');
  assert.equal(calls[1].options.headers.Authorization, 'Bearer test-only');
  assert.match(calls[1].url, /^\/api\/uploads\//);
});
