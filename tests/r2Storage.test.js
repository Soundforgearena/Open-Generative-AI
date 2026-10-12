import test from 'node:test';
import assert from 'node:assert/strict';
import { sealR2Keys, openR2Keys, publicR2Status, resolveR2Binding, validateR2Keys, r2Environment } from '../lib/storage/r2-config.js';
import { testStorageConnection, presignUrl } from '../lib/storage/provider.js';
import { mediaReadUrl, verifyMediaRead, parseR2Path, exactSizeStream, r2AssetPathMatches } from '../lib/storage/media-tokens.js';

const env = { STORAGE_CREDENTIALS_ENCRYPTION_KEY: 'ab'.repeat(32), NEXT_PUBLIC_SITE_URL: 'https://cinexvideo.app' };
const keys = { accessKeyId: 'a'.repeat(32), secretAccessKey: 'b'.repeat(64) };
const binding = resolveR2Binding();
const providerEnv = r2Environment(binding, keys);
const path = 'r2://cinexvideo-vault/refs/owner/project/asset';

test('R2 defaults bind the account, private bucket, region and endpoint without extra fields', () => {
  assert.equal(binding.accountId, '64897aa07bba43a38a79a7f17201340f');
  assert.equal(binding.bucket, 'cinexvideo-vault');
  assert.equal(providerEnv.STORAGE_S3_REGION, 'auto');
  assert.equal(providerEnv.STORAGE_S3_ENDPOINT, `https://${binding.accountId}.r2.cloudflarestorage.com`);
});

test('R2 connection never accepts arbitrary endpoints or malformed keys', () => {
  assert.throws(() => resolveR2Binding({ accountId: 'https://attacker.example' }));
  assert.throws(() => resolveR2Binding({ bucket: '../private' }));
  assert.throws(() => resolveR2Binding({ jurisdiction: 'invalid' }));
  assert.throws(() => validateR2Keys({ accessKeyId: 'api-token', secretAccessKey: keys.secretAccessKey }));
  assert.throws(() => validateR2Keys({ ...keys, secretAccessKey: '' }));
  assert.deepEqual(validateR2Keys({ ...keys, accessKeyId: ` ${keys.accessKeyId} ` }), keys);
});

test('saved keys are authenticated ciphertext with a unique IV', () => {
  const sealed = sealR2Keys(keys, binding, env);
  assert.deepEqual(openR2Keys(sealed, binding, env), keys);
  assert.notEqual(sealed.iv, sealR2Keys(keys, binding, env).iv);
  assert.ok(!JSON.stringify(sealed).includes(keys.secretAccessKey));
  assert.throws(() => openR2Keys(sealed, { ...binding, bucket: 'another-bucket' }, env));
  assert.throws(() => openR2Keys({ ...sealed, tag: Buffer.alloc(16).toString('base64') }, binding, env));
  assert.throws(() => openR2Keys(sealed, binding, { STORAGE_CREDENTIALS_ENCRYPTION_KEY: 'cd'.repeat(32) }));
});

test('status whitelist cannot expose credentials or ciphertext', () => {
  const saved = { binding, credentials: sealR2Keys(keys, binding, env), verifiedAt: '2026-10-11T00:00:00Z', keyHint: 'aaaa', extraSecret: 'hidden' };
  const status = publicR2Status(saved, env);
  assert.equal(status.verified, true);
  assert.equal(status.encryptionReady, true);
  for (const secret of [keys.accessKeyId, keys.secretAccessKey, saved.credentials.ciphertext, 'hidden']) assert.ok(!JSON.stringify(status).includes(secret));
  assert.equal(publicR2Status(null, {}).encryptionReady, false);
});

test('S3 signing escapes special characters, uses auto region and signs bucket probes', () => {
  const signed = new URL(presignUrl('PUT', "refs/file !'().png", { env: providerEnv, now: Date.UTC(2026, 9, 11) }));
  assert.match(signed.pathname, /file%20%21%27%28%29\.png$/);
  assert.match(signed.searchParams.get('X-Amz-Credential'), /20261011\/auto\/s3\/aws4_request/);
  assert.match(signed.searchParams.get('X-Amz-Signature'), /^[a-f0-9]{64}$/);
  assert.equal(new URL(presignUrl('HEAD', '', { env: providerEnv })).pathname, '/cinexvideo-vault');
  assert.throws(() => presignUrl('PUT', '../other', { env: providerEnv }));
});

test('connection verification performs write, exact readback and cleanup', async () => {
  const methods = [];
  const result = await testStorageConnection({ env: providerEnv, fetchImpl: async (_url, opts) => {
    methods.push(opts.method || 'GET');
    assert.equal(opts.redirect, 'error');
    assert.ok(opts.signal);
    return (opts.method || 'GET') === 'GET' ? new Response('CineXVideo storage check') : new Response(null, { status: 204 });
  } });
  assert.equal(result.ok, true);
  assert.deepEqual(methods, ['PUT', 'GET', 'DELETE']);
});

test('failed readback still cleans up and cannot claim connection success', async () => {
  const methods = [];
  const result = await testStorageConnection({ env: providerEnv, fetchImpl: async (_url, opts) => {
    methods.push(opts.method || 'GET');
    return opts.method ? new Response(null, { status: 204 }) : new Response('wrong data');
  } });
  assert.equal(result.ok, false);
  assert.equal(result.step, 'read');
  assert.equal(methods.at(-1), 'DELETE');
});

test('uncertain writes attempt cleanup; failed cleanup blocks success', async () => {
  const methods = [];
  const uncertain = await testStorageConnection({ env: providerEnv, fetchImpl: async (_url, opts) => {
    methods.push(opts.method || 'GET');
    if (opts.method === 'PUT') throw new Error('timeout');
    return new Response(null, { status: 204 });
  } });
  assert.equal(uncertain.ok, false);
  assert.deepEqual(methods, ['PUT', 'DELETE']);
  const result = await testStorageConnection({ env: providerEnv, fetchImpl: async (_url, opts) => {
    if (opts.method === 'DELETE') return new Response(null, { status: 403 });
    return opts.method === 'PUT' ? new Response(null, { status: 204 }) : new Response('CineXVideo storage check');
  } });
  assert.deepEqual(result, { ok: false, step: 'cleanup' });
});

test('private read links expire and bind their signature to the exact object', () => {
  const now = Date.UTC(2026, 9, 11);
  const url = new URL(mediaReadUrl(path, 900, env, now));
  const q = url.searchParams;
  assert.equal(url.origin, 'https://cinexvideo.app');
  assert.equal(verifyMediaRead(path, q.get('expires'), q.get('signature'), env, now), true);
  assert.equal(verifyMediaRead(path.replace('/asset', '/other'), q.get('expires'), q.get('signature'), env, now), false);
  assert.equal(verifyMediaRead(path, q.get('expires'), q.get('signature'), env, now + 901000), false);
  assert.equal(verifyMediaRead(path, q.get('expires'), '0'.repeat(64), env, now), false);
});

test('media namespaces reject cross-project object references and traversal', () => {
  assert.throws(() => parseR2Path('r2://cinexvideo-vault/refs/../secret'));
  assert.throws(() => parseR2Path('https://attacker.example/file'));
  const asset = { id: 'asset', project_id: 'project', storage_path: path };
  assert.equal(r2AssetPathMatches(asset, 'owner'), true);
  assert.equal(r2AssetPathMatches(asset, 'other-owner'), false);
  assert.equal(r2AssetPathMatches({ ...asset, project_id: 'other-project' }, 'owner'), false);
});

test('streamed transfers reject oversized and truncated bodies', async () => {
  assert.equal(await new Response(exactSizeStream(new Response('abc').body, 3)).text(), 'abc');
  await assert.rejects(new Response(exactSizeStream(new Response('abcd').body, 3)).text(), /exceeds/);
  await assert.rejects(new Response(exactSizeStream(new Response('ab').body, 3)).text(), /did not match/);
  assert.throws(() => exactSizeStream(new Response('a').body, 1.5));
});
