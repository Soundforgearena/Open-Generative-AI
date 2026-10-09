import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describeStorage, presignUrl } from '../lib/storage/provider.js';

const env = {
  STORAGE_S3_ENDPOINT: 'https://acct.r2.cloudflarestorage.com',
  STORAGE_S3_BUCKET: 'refs-test',
  STORAGE_S3_ACCESS_KEY_ID: 'AKIAEXAMPLE',
  STORAGE_S3_SECRET_ACCESS_KEY: 'super-secret-value',
};

test('describeStorage reports presence only, never secrets', () => {
  const status = describeStorage(env);
  assert.equal(status.configured, true);
  assert.equal(status.provider, 'Cloudflare R2');
  assert.equal(JSON.stringify(status).includes('super-secret-value'), false);
  assert.deepEqual(describeStorage({}).missing.length, 4);
});

test('presignUrl is deterministic, path-style, expiring and never leaks the secret', () => {
  const now = Date.UTC(2026, 0, 2, 3, 4, 5);
  const a = presignUrl('PUT', 'refs/u1/p1/a b.png', { env, now, expiresIn: 300 });
  assert.equal(a, presignUrl('PUT', 'refs/u1/p1/a b.png', { env, now, expiresIn: 300 }));
  const url = new URL(a);
  assert.equal(url.origin, 'https://acct.r2.cloudflarestorage.com');
  assert.equal(url.pathname, '/refs-test/refs/u1/p1/a%20b.png');
  assert.equal(url.searchParams.get('X-Amz-Expires'), '300');
  assert.equal(url.searchParams.get('X-Amz-Date'), '20260102T030405Z');
  assert.match(url.searchParams.get('X-Amz-Credential'), /^AKIAEXAMPLE\/20260102\/auto\/s3\/aws4_request$/);
  assert.equal(a.includes('super-secret-value'), false);
  assert.notEqual(a, presignUrl('GET', 'refs/u1/p1/a b.png', { env, now, expiresIn: 300 }));
});

test('presignUrl clamps expiry and refuses an unconfigured store', () => {
  assert.equal(new URL(presignUrl('GET', 'k', { env, expiresIn: 99999999 })).searchParams.get('X-Amz-Expires'), '604800');
  assert.throws(() => presignUrl('GET', 'k', { env: {} }), /not connected/);
});

test('R2 migration plan is committed without credentials and lists unresolved prerequisites', async () => {
  const doc = await readFile(new URL('../docs/r2-storage-migration-plan.md', import.meta.url), 'utf8');
  for (const heading of ['Private-by-default signed URL flow', 'CORS', 'Lifecycle / retention', 'Migration / backfill', 'Rollback', 'Unresolved prerequisites']) {
    assert.ok(doc.includes(heading), heading);
  }
  assert.doesNotMatch(doc, /AKIA[0-9A-Z]{12,}|-----BEGIN/);
});
