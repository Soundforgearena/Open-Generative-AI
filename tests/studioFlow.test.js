import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { orderVersions, previewTake } from '../lib/studio/studio-model.js';
import { createStaleGuard } from '../lib/studio/async-guard.js';

test('orderVersions is newest-first and deterministic for ties and missing fields', () => {
  const a = { id: 'a', version: 2, created_at: '2026-01-01T00:00:00Z' };
  const b = { id: 'b', version: 2, created_at: '2026-01-02T00:00:00Z' };
  const c = { id: 'c', version: 3 };
  const d = { id: 'd', version: 1 };
  const expected = ['c', 'b', 'a', 'd'];
  assert.deepEqual(orderVersions([d, a, b, c]).map((v) => v.id), expected);
  assert.deepEqual(orderVersions([a, c, d, b]).map((v) => v.id), expected);
  assert.deepEqual(orderVersions([c, b, a, d]).map((v) => v.id), expected);
  assert.deepEqual(orderVersions(undefined), []);
});

test('orderVersions does not mutate its input', () => {
  const input = [{ id: 'x', version: 1 }, { id: 'y', version: 2 }];
  orderVersions(input);
  assert.equal(input[0].id, 'x');
});

test('previewTake prefers newest take with output regardless of array order', () => {
  const approved = { id: 'a', version: 1, approved: true, output_url: 'one.mp4' };
  const latest = { id: 'b', version: 2, output_url: 'two.mp4' };
  const pending = { id: 'c', version: 3, status: 'generating' };
  assert.equal(previewTake([approved, latest]), latest);
  assert.equal(previewTake([pending, approved]), approved);
  assert.equal(previewTake([pending]), pending);
  assert.equal(previewTake([]), null);
});

test('stale guard drops results after the key changes or after stop', () => {
  let key = 'p1';
  const guard = createStaleGuard(() => key);
  guard.start();
  const first = guard.capture();
  assert.equal(first(), true);
  key = 'p2';
  assert.equal(first(), false);
  const second = guard.capture();
  assert.equal(second(), true);
  guard.stop();
  assert.equal(second(), false);
  guard.start();
  assert.equal(guard.capture()(), true);
});

const read = (p) => readFile(new URL(p, import.meta.url), 'utf8');

test('Studio gates async results with the stale guard and no longer shows demo prices', async () => {
  const src = await read('../components/studio/Studio.js');
  assert.match(src, /createStaleGuard/);
  assert.ok((src.match(/guardRef\.current\.capture\(\)/g) || []).length >= 6);
  assert.match(src, /demo: true/);
  assert.match(src, /Demo preview only/);
  assert.doesNotMatch(src, /credits_required: 80/);
});

test('demo export dialog cannot reach render or download actions', async () => {
  const src = await read('../components/studio/Studio.js');
  const run = src.slice(src.indexOf('async function runExport'), src.indexOf('function closeExport'));
  assert.ok(run.indexOf('demoModeEnabled') < run.indexOf('renderFinishedVideoFile'));
  assert.match(src, /exportState\.phase === 'choose' && !exportState\.demo/);
});

test('Director locks duplicate submissions and ignores results for another scene', async () => {
  const src = await read('../components/studio/StudioDirector.js');
  assert.match(src, /if \(actionLock\.current\) return;/);
  assert.match(src, /actionLock\.current = false;/);
  assert.match(src, /if \(!isCurrent\(\)\) return;/);
  assert.doesNotMatch(src, /setBusy\(action \+ custom\)/);
});
