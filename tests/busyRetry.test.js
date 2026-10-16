import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handleBusyFailure, isBusyFailure, currentRequestId, MAX_BUSY_RETRIES, retryState } from '../lib/generation/busy-retry.js';

const BUSY = { status: 'failed', error: 'Request Has Reached API Concurrent Limit, Please Try Later' };
const job = (busy) => ({ id: 'j1', provider_request_id: 'orig', status: 'running', output: { busy_retry: busy } });
const state = (extra = {}) => ({ ...retryState({ endpoint: 'omnihuman-1-5', input: { image_url: 'i', audio_url: 'a' } }).busy_retry, ...extra });

function store(rows = 1) {
  const writes = [];
  return { writes, updateRows: async (table, filters, patch) => { writes.push({ filters, patch }); return { ok: true, data: Array(rows).fill({}) }; } };
}

test('busy failures are recognised; ordinary failures are not', () => {
  assert.equal(isBusyFailure(BUSY), true);
  assert.equal(isBusyFailure({ error: 'The text length cannot exceed the maximum limit' }), false);
  assert.equal(isBusyFailure({}, 429), true);
});

test('a busy job waits first, then resubmits the same input once per attempt', async () => {
  const s = store();
  const t0 = Date.parse('2026-10-16T18:00:00Z');
  const first = await handleBusyFailure({ job: job(state()), data: BUSY, base: 'b', apiKey: 'k', updateRows: s.updateRows, now: t0, fetchImpl: () => { throw new Error('must wait first'); } });
  assert.equal(first.action, 'waiting');
  const waited = s.writes[0].patch.output.busy_retry;
  const early = await handleBusyFailure({ job: job(waited), data: BUSY, base: 'b', apiKey: 'k', updateRows: s.updateRows, now: t0 + 1000, fetchImpl: () => { throw new Error('too early'); } });
  assert.equal(early.action, 'waiting');
  let posted = null;
  const fetchImpl = async (url, opts) => { posted = { url, body: JSON.parse(opts.body) }; return { ok: true, json: async () => ({ request_id: 'new1' }) }; };
  const again = await handleBusyFailure({ job: job(waited), data: BUSY, base: 'b', apiKey: 'k', updateRows: s.updateRows, now: t0 + 31_000, fetchImpl });
  assert.equal(again.action, 'resubmitted');
  assert.equal(posted.url, 'b/api/v1/omnihuman-1-5');
  assert.deepEqual(posted.body, { image_url: 'i', audio_url: 'a' });
  const saved = s.writes.at(-1).patch.output.busy_retry;
  assert.equal(saved.current_request_id, 'new1');
  assert.equal(saved.attempts, 1);
  assert.equal(currentRequestId(job(saved)), 'new1');
});

test('two open tabs cannot resubmit the same attempt twice', async () => {
  const s = store(0); // the claim matched no row: someone else took it
  const r = await handleBusyFailure({ job: job(state({ next_at: '2000-01-01T00:00:00Z' })), data: BUSY, base: 'b', apiKey: 'k', updateRows: s.updateRows, fetchImpl: () => { throw new Error('no double submit'); } });
  assert.equal(r.action, 'waiting');
});

test('retries stop after the limit and ordinary failures fail straight away', async () => {
  const s = store();
  const done = await handleBusyFailure({ job: job(state({ attempts: MAX_BUSY_RETRIES })), data: BUSY, base: 'b', apiKey: 'k', updateRows: s.updateRows });
  assert.equal(done.action, 'exhausted');
  const plain = await handleBusyFailure({ job: job(state()), data: { error: 'bad image' }, base: 'b', apiKey: 'k', updateRows: s.updateRows });
  assert.equal(plain.action, 'not_busy');
});

test('routes use the live attempt id and offer a priced two-step fallback', () => {
  const jobs = readFileSync(new URL('../app/api/jobs/[requestId]/route.js', import.meta.url), 'utf8');
  assert.match(jobs, /currentRequestId\(job\)/);
  assert.match(jobs, /busy: true/);
  const cron = readFileSync(new URL('../app/api/admin/cron/reconcile/route.js', import.meta.url), 'utf8');
  assert.match(cron, /currentRequestId\(job\)/);
  const gen = readFileSync(new URL('../app/api/generate/route.js', import.meta.url), 'utf8');
  assert.match(gen, /retryState\(\{ endpoint: providerEndpoint, input: canonicalInput \}\)/);
  assert.match(gen, /body\.engine === 'two_step'/);
  const studio = readFileSync(new URL('../components/studio/Studio.js', import.meta.url), 'utf8');
  assert.match(studio, /Singing model busy · use the two-step method\?/);
});
