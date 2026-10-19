import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { finalCutKey, cutFingerprint, shouldReplaceFinal, saveFinalCut, finalCutView } from '../lib/storage/final-cut.js';
import { presignUrl } from '../lib/storage/provider.js';

const env = {
  STORAGE_S3_ENDPOINT: 'https://acct.r2.cloudflarestorage.com', STORAGE_S3_BUCKET: 'cinexvideo-media',
  STORAGE_S3_REGION: 'auto', STORAGE_S3_ACCESS_KEY_ID: 'AKIDEXAMPLE', STORAGE_S3_SECRET_ACCESS_KEY: 'secretexample',
};

test('one final cut per project, under the owner folder', () => {
  assert.equal(finalCutKey('u1', 'p1'), 'finals/u1/p1/final-cut.mp4');
  assert.equal(finalCutKey('../x', 'p1'), 'finals/unknown/p1/final-cut.mp4');
});

test('a watermarked render never replaces the paid copy of the same cut', () => {
  const cut = cutFingerprint([{ version_id: 'a' }, { version_id: 'b' }]);
  const paid = { ref: 'media:r2/finals/u/p/final-cut.mp4', clean: true, cut };
  assert.equal(shouldReplaceFinal(paid, { clean: false, cut }), false);
  assert.equal(shouldReplaceFinal(paid, { clean: false, cut: cutFingerprint([{ version_id: 'c' }]) }), true);
  assert.equal(shouldReplaceFinal(paid, { clean: true, cut }), true);
  assert.equal(shouldReplaceFinal(null, { clean: false, cut }), true);
});

test('saveFinalCut uploads, verifies size and returns the record', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'fc-'));
  const file = path.join(dir, 'final.mp4');
  await writeFile(file, Buffer.alloc(2048, 7));
  const calls = [];
  const put = async (url, f, size) => { calls.push(['PUT', url, size]); return 200; };
  const head = async (url) => { calls.push(['HEAD', url]); return { ok: true, status: 200, headers: new Map([['content-length', '2048']]) }; };
  const r = await saveFinalCut({ file, size: 2048, ownerId: 'u1', projectId: 'p1', clean: false, cut: 'abc', seconds: 12.345, width: 1920, height: 1080, env, put, head, now: () => new Date('2026-10-19T12:00:00Z') });
  assert.equal(r.ok, true);
  assert.equal(r.key, 'finals/u1/p1/final-cut.mp4');
  assert.match(r.sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(r.record, { ref: 'media:r2/finals/u1/p1/final-cut.mp4', bytes: 2048, clean: false, cut: 'abc', seconds: 12.35, width: 1920, height: 1080, saved_at: '2026-10-19T12:00:00.000Z' });
  assert.match(calls[0][1], /\/cinexvideo-media\/finals\/u1\/p1\/final-cut\.mp4\?/);
  const bad = await saveFinalCut({ file, size: 2048, ownerId: 'u1', projectId: 'p1', env, put: async () => 500, head });
  assert.equal(bad.ok, false);
  const wrong = await saveFinalCut({ file, size: 2048, ownerId: 'u1', projectId: 'p1', env, put, head: async () => ({ ok: true, headers: new Map([['content-length', '1']]) }) });
  assert.equal(wrong.reason, 'verify_failed');
  assert.equal((await saveFinalCut({ file, size: 2048, ownerId: 'u1', projectId: 'p1', env: {} })).reason, 'storage_off');
});

test('final cut links expire in 15 minutes and download with the project name', () => {
  const v = finalCutView({ ref: 'media:r2/finals/u1/p1/final-cut.mp4', clean: false, bytes: 10, seconds: 5, saved_at: 'x' }, "Act Normal Now", { env });
  assert.equal(v.file_name, 'Act Normal Now - CineXVideo.mp4');
  assert.match(v.play_url, /X-Amz-Expires=900/);
  assert.match(v.download_url, /response-content-disposition=attachment%3B%20filename%3D%22Act%20Normal%20Now%20-%20CineXVideo\.mp4%22/);
  assert.ok(!/'/.test(v.download_url), 'apostrophes are percent-encoded for S3 signing');
  assert.equal(finalCutView(null, 'x', { env }), null);
  assert.equal(finalCutView({ ref: 'https://cdn.example/x.mp4' }, 'x', { env }), null);
});

test('extra signed query params are part of the signature', () => {
  const a = presignUrl('GET', 'k.mp4', { env, now: 0 });
  const b = presignUrl('GET', 'k.mp4', { env, now: 0, query: { 'response-content-type': 'video/mp4' } });
  assert.notEqual(a.split('X-Amz-Signature=')[1], b.split('X-Amz-Signature=')[1]);
});

test('export saves the final cut and only then deletes the rendered file', () => {
  const r = readFileSync(new URL('../app/api/exports/video/route.js', import.meta.url), 'utf8');
  assert.match(r, /saveFinalCut\(/);
  assert.match(r, /Promise\.all\(\[streamEnded, saving\]\)\.finally\(\(\) => rendered\.cleanup\(\)\)/);
  assert.match(r, /kind: 'final'/);
  const g = readFileSync(new URL('../app/api/projects/[id]/route.js', import.meta.url), 'utf8');
  assert.match(g, /final_cut: finalCutView\(project\.final_cut, project\.title\)/);
  const m = readFileSync(new URL('../supabase/migrations/20261019170000_final_cut.sql', import.meta.url), 'utf8');
  assert.match(m, /add column if not exists final_cut jsonb/);
  assert.match(m, /check \(kind in \('take', 'still', 'final'\)\)/);
  const s = readFileSync(new URL('../components/studio/Studio.js', import.meta.url), 'utf8');
  assert.ok(!/kept by the video provider/.test(s));
  assert.match(s, /<FinalCutCard finalCut=\{project\?\.final_cut\} \/>/);
});
