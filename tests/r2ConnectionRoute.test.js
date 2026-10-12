import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as config from '../lib/storage/r2-config.js';

let context;
const dependencies = {
  guard: (...args) => context.guard(...args),
  safeError: (error, status = 400) => Response.json({ error }, { status }),
  rateLimit: () => null,
  ...config,
  encryptionReady: () => context.encryptionReady !== false,
  sealR2Keys: (keys, binding) => config.sealR2Keys(keys, binding, { STORAGE_CREDENTIALS_ENCRYPTION_KEY: 'ab'.repeat(32) }),
  publicR2Status: (saved) => config.publicR2Status(saved, { STORAGE_CREDENTIALS_ENCRYPTION_KEY: 'ab'.repeat(32) }),
  savedR2Connection: async () => context.saved || null,
  ensureR2Bucket: async () => { context.probes++; return { created: false }; },
  testStorageConnection: async () => context.check || { ok: true, cleanup: true },
  saveR2Connection: async (value) => { context.writes++; context.saved = value; },
};
globalThis.__r2RouteDependencies = dependencies;
const source = (await readFile(new URL('../app/api/admin/storage/connection/route.js', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '');
const module = await import(`data:text/javascript;base64,${Buffer.from(
  `const {${Object.keys(dependencies).join(',')}}=globalThis.__r2RouteDependencies;\n${source}`,
).toString('base64')}`);
const input = { accessKeyId: 'a'.repeat(32), secretAccessKey: 'b'.repeat(64) };
const req = () => new Request('https://cinexvideo.app/api/admin/storage/connection', { method: 'POST', body: JSON.stringify(input) });
const setup = () => { context = { probes: 0, writes: 0, guard: async () => ({ user: { id: 'admin' }, superAdmin: true }) }; };

test('storage credentials are rejected before parsing for unauthenticated or non-super-admin users', async () => {
  for (const status of [401, 403]) {
    setup();
    context.guard = async (_request, options) => {
      assert.equal(options.requireSuperAdmin, true);
      return { error: Response.json({ error: 'not allowed' }, { status }) };
    };
    assert.equal((await module.POST(req())).status, status);
    assert.equal(context.probes, 0);
    assert.equal(context.writes, 0);
  }
});

test('missing encryption setup rejects credentials without provider calls', async () => {
  setup(); context.encryptionReady = false;
  assert.equal((await module.POST(req())).status, 503);
  assert.equal(context.probes, 0);
  assert.equal(context.writes, 0);
});

test('successful verification saves ciphertext and returns only safe metadata', async () => {
  setup();
  const response = await module.POST(req());
  assert.equal(response.status, 200);
  assert.equal(context.writes, 1);
  const text = await response.text();
  for (const value of Object.values(input)) {
    assert.ok(!text.includes(value));
    assert.ok(!JSON.stringify(context.saved).includes(value));
  }
  assert.equal(JSON.parse(text).storage.verified, true);
});

test('failed credential rotation preserves the previously verified connection', async () => {
  setup();
  const previous = { binding: config.resolveR2Binding(), credentials: { ciphertext: 'existing' }, verifiedAt: '2026-10-11T00:00:00Z' };
  context.saved = previous;
  context.check = { ok: false, step: 'write', status: 403 };
  assert.equal((await module.POST(req())).status, 422);
  assert.equal(context.writes, 0);
  assert.equal(context.saved, previous);
});

test('changing the storage binding after connection fails without touching objects', async () => {
  setup();
  context.saved = { binding: config.resolveR2Binding(), credentials: {}, verifiedAt: 'now' };
  const request = new Request('https://cinexvideo.app/api/admin/storage/connection', {
    method: 'POST', body: JSON.stringify({ ...input, binding: { bucket: 'another-bucket' } }),
  });
  assert.equal((await module.POST(request)).status, 409);
  assert.equal(context.probes, 0);
  assert.equal(context.writes, 0);
});
