import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { orderVersions, previewTake } from '../lib/studio/studio-model.js';
import { createStaleGuard } from '../lib/studio/async-guard.js';
import { createActionLock } from '../lib/studio/action-lock.js';

test('take order is deterministic, newest-first, and does not mutate the API list', () => {
  const older = { id: 'a', version: 2, created_at: '2026-01-01T00:00:00Z' };
  const newer = { id: 'b', version: 2, created_at: '2026-01-02T00:00:00Z' };
  const highest = { id: 'c', version: 3 };
  const input = [older, newer, highest];
  assert.deepEqual(orderVersions(input), [highest, newer, older]);
  assert.deepEqual(orderVersions([newer, older, highest]), [highest, newer, older]);
  assert.deepEqual(input, [older, newer, highest]);
});

test('review selects newest output, then approved take, then newest take', () => {
  const approved = { version: 1, approved: true, output_url: 'approved.mp4' };
  const output = { version: 2, output_url: 'newest.mp4' };
  const generating = { version: 3, status: 'generating' };
  assert.equal(previewTake([approved, output]), output);
  assert.equal(previewTake([generating, approved]), approved);
  assert.equal(previewTake([generating]), generating);
  assert.equal(previewTake([]), null);
});

test('stale guard invalidates results after a key change or unmount', () => {
  let key = 'project-a';
  const guard = createStaleGuard(() => key);
  guard.start();
  const projectResult = guard.capture();
  assert.equal(projectResult(), true);
  key = 'project-b';
  assert.equal(projectResult(), false);
  const unmountedResult = guard.capture();
  guard.stop();
  assert.equal(unmountedResult(), false);
  guard.start();
  assert.equal(unmountedResult(), false);
  const sameKeyAfterNavigation = guard.capture();
  guard.invalidate();
  assert.equal(sameKeyAfterNavigation(), false);
  assert.equal(guard.capture()(), true);
});

test('Director action lock admits one in-flight request and releases for retry', () => {
  const lock = createActionLock();
  assert.equal(lock.tryAcquire(), true);
  assert.equal(lock.tryAcquire(), false);
  lock.release();
  assert.equal(lock.tryAcquire(), true);
  lock.release();
});

test('Director retry preserves one idempotency key until a definitive response', async () => {
  const source = await readFile(
    new URL('../components/studio/StudioDirector.js', import.meta.url),
    'utf8',
  );

  assert.match(source, /activeIdempotencyKeyRef\.current = idempotencyKey;/);
  assert.match(source, /retryIdempotencyKey = null/);
  assert.match(source, /idempotencyKey = retryIdempotencyKey \|\| crypto\.randomUUID\(\)/);
  assert.match(source, /idempotencyKey,/);
  assert.match(source, /setRetryAction\(\{ action, custom, idempotencyKey \}\)/);
  assert.match(
    source,
    /run\(retryAction\.action, retryAction\.custom, retryAction\.idempotencyKey\)/,
  );

  const successIndex = source.indexOf('setResult(data);');
  const definitiveSuccess = source.indexOf('activeIdempotencyKeyRef.current = null;', successIndex);
  assert.ok(definitiveSuccess > successIndex);

  const paymentFailureIndex = source.indexOf('requestError.status === 402');
  const definitivePaymentFailure = source.indexOf(
    'activeIdempotencyKeyRef.current = null;',
    paymentFailureIndex,
  );
  assert.ok(definitivePaymentFailure > paymentFailureIndex);

  const retryIndex = source.indexOf('setRetryAction({ action, custom, idempotencyKey });');
  assert.ok(retryIndex > -1);
  assert.ok(!source.slice(retryIndex, retryIndex + 300).includes('activeIdempotencyKeyRef.current = null;'));
});

test('Studio guards async work and never exposes paid demo export controls', async () => {
  const source = await readFile(
    new URL('../components/studio/Studio.js', import.meta.url),
    'utf8',
  );
  assert.ok((source.match(/guardRef\.current\.capture\(\)/g) || []).length >= 6);
  const exportHandler = source.slice(
    source.indexOf('async function runExport'),
    source.indexOf('function closeExport'),
  );
  assert.ok(
    exportHandler.indexOf('demoModeEnabled') < exportHandler.indexOf('renderFinishedVideoFile'),
  );
  assert.match(source, /exportState\.phase === 'choose' && !exportState\.demo/);
  assert.match(source, /Demo preview only/);
  assert.doesNotMatch(source, /credits_required: 80/);
});

test('Director uses the tested lock and offers retry after request errors', async () => {
  const source = await readFile(
    new URL('../components/studio/StudioDirector.js', import.meta.url),
    'utf8',
  );
  assert.match(source, /actionLock\.current\.tryAcquire\(\)/);
  assert.match(source, /actionLock\.current\.release\(\)/);
  assert.match(source, /if \(!isCurrent\(\)\) return;/);
  assert.match(source, />Try again<\/button>/);
  assert.match(source, /busy === 'applyDirectorInstruction'/);
});

test('Studio load errors provide a real retry trigger for the loading effect', async () => {
  const source = await readFile(
    new URL('../components/studio/Studio.js', import.meta.url),
    'utf8',
  );
  assert.match(source, /loadState === 'error' && <button/);
  assert.match(source, />Try again<\/button>/);
  assert.match(source, /\[projectParam, applyProject, loadAttempt\]/);
  assert.match(source, /setLoadAttempt\(\(attempt\) => attempt \+ 1\)/);
});
