import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FAILOVER_CHAINS, STUCK_AFTER_MS, attemptIsStuck, handleFailover, remainingFallbacks } from '../lib/generation/failover.js';
import { retryState } from '../lib/generation/busy-retry.js';
import { LIKENESS_VIDEO_MODEL, LIP_SYNC_MODEL, PERFORM_MODEL } from '../lib/music/likeness.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

function harness(job) {
  const updates = [];
  const submitted = [];
  const events = [];
  return {
    updates, submitted, events,
    updateRows: async (table, filter, patch) => { updates.push({ filter, patch }); job.output = patch.output; return { ok: true, data: [{ id: job.id }] }; },
    insertRows: async (table, row) => { events.push(row); return { ok: true }; },
    fetchImpl: (accept) => async (url, init) => { submitted.push({ model: url.split('/').pop(), body: JSON.parse(init.body) }); return accept(url) ? { ok: true, json: async () => ({ request_id: `new-${submitted.length}` }) } : { ok: false, json: async () => ({}) }; },
  };
}

test('every primary model has a reliable backup that takes the same inputs', () => {
  for (const m of [PERFORM_MODEL, LIKENESS_VIDEO_MODEL, LIP_SYNC_MODEL, 'seedance-2-omni-reference-no-video-fast', 'kling-v3.0-std-motion-control']) {
    assert.ok(FAILOVER_CHAINS[m]?.length, m);
  }
  assert.deepEqual(FAILOVER_CHAINS[PERFORM_MODEL].map((o) => o.model), ['infinitetalk-image-to-video', 'ltx-2.3-lipsync']);
  assert.deepEqual(FAILOVER_CHAINS[LIKENESS_VIDEO_MODEL].map((o) => o.model), ['kling-v2.1-standard-i2v', 'pixverse-v6-i2v']);
  const sung = FAILOVER_CHAINS[PERFORM_MODEL][0].build({ prompt: 'p', image_url: 'still', audio_url: 'slice' });
  assert.deepEqual(sung, { prompt: 'p', image_url: 'still', audio_url: 'slice', resolution: '720p' });
  const kling = FAILOVER_CHAINS[LIKENESS_VIDEO_MODEL][0].build({ prompt: 'p', image_url: 'still', duration: 7, aspect_ratio: '9:16' });
  assert.deepEqual(kling, { prompt: 'p', image_url: 'still', duration: 10, aspect_ratio: '9:16' });
  const dance = FAILOVER_CHAINS['seedance-2-omni-reference-no-video-fast'][0].build({ prompt: 'p', images_list: ['still'], audio_files: ['a'], duration: 15, aspect_ratio: '16:9' });
  assert.equal(dance.image_url, 'still');
  assert.equal(dance.duration, 12);
  assert.equal(dance.generate_audio, false);
});

test('LTX lip sync is skipped for audio longer than 20 s', () => {
  assert.deepEqual(remainingFallbacks({ primary_model: PERFORM_MODEL, failover_index: 0, audio_seconds: 25 }).map((o) => o.model), ['infinitetalk-image-to-video']);
  assert.deepEqual(remainingFallbacks({ primary_model: PERFORM_MODEL, failover_index: 1, audio_seconds: 8 }).map((o) => o.model), ['ltx-2.3-lipsync']);
  assert.deepEqual(remainingFallbacks({ primary_model: PERFORM_MODEL, failover_index: 2 }), []);
});

test('a failed sung take moves to InfiniteTalk with the same still and song slice', async () => {
  const job = { id: 'j1', operation: 'video', user_id: 'u', output: retryState({ endpoint: PERFORM_MODEL, input: { prompt: 'sing', image_url: 'r2://still', audio_url: 'r2://slice' }, primaryModel: PERFORM_MODEL, audioSeconds: 7 }) };
  const h = harness(job);
  const r = await handleFailover({ job, base: 'https://api.muapi.ai', apiKey: 'k', updateRows: h.updateRows, insertRows: h.insertRows, fetchImpl: h.fetchImpl(() => true) });
  assert.deepEqual(r, { action: 'failed_over', model: 'infinitetalk-image-to-video' });
  assert.equal(h.submitted[0].model, 'infinitetalk-image-to-video');
  const state = job.output.busy_retry;
  assert.equal(state.endpoint, 'infinitetalk-image-to-video');
  assert.equal(state.current_request_id, 'new-1');
  assert.equal(state.failover_index, 1);
  assert.equal(state.attempts, 0);
  assert.equal(state.original_input.image_url, 'r2://still');
  assert.equal(h.updates[0].filter['output->busy_retry->>failover_index'], 'eq.0');
  assert.equal(h.events[0].event_type, 'generation_failover');
  // Second failure: LTX, built from the original input.
  const r2 = await handleFailover({ job, base: 'b', apiKey: 'k', updateRows: h.updateRows, fetchImpl: h.fetchImpl(() => true) });
  assert.equal(r2.model, 'ltx-2.3-lipsync');
  assert.equal(h.submitted[1].body.image_url.startsWith('r2://') || h.submitted[1].body.image_url.length > 0, true);
  // Third failure: nothing left, so the normal refund path runs.
  assert.deepEqual(await handleFailover({ job, base: 'b', apiKey: 'k', updateRows: h.updateRows, fetchImpl: h.fetchImpl(() => true) }), { action: 'none' });
});

test('a rejected backup is skipped for the next one; old jobs without a chain are left alone', async () => {
  const job = { id: 'j2', operation: 'video', output: retryState({ endpoint: LIKENESS_VIDEO_MODEL, input: { prompt: 'p', image_url: 's', duration: 7 }, primaryModel: LIKENESS_VIDEO_MODEL }) };
  const h = harness(job);
  const r = await handleFailover({ job, base: 'b', apiKey: 'k', updateRows: h.updateRows, fetchImpl: h.fetchImpl((url) => url.endsWith('pixverse-v6-i2v')) });
  assert.equal(r.model, 'pixverse-v6-i2v');
  assert.deepEqual(h.submitted.map((s) => s.model), ['kling-v2.1-standard-i2v', 'pixverse-v6-i2v']);
  assert.deepEqual(await handleFailover({ job: { id: 'old', output: { busy_retry: { endpoint: 'x', input: {} } } }, base: 'b', apiKey: 'k', updateRows: async () => ({ ok: true, data: [] }) }), { action: 'none' });
});

test('a job stuck for 20 minutes counts as failed', () => {
  const now = Date.parse('2026-10-20T12:00:00Z');
  assert.equal(attemptIsStuck({ output: { busy_retry: { submitted_at: new Date(now - STUCK_AFTER_MS - 1000).toISOString() } } }, now), true);
  assert.equal(attemptIsStuck({ output: { busy_retry: { submitted_at: new Date(now - 60_000).toISOString() } } }, now), false);
});

test('routes use the reliable models, fail over, and stills have backups', () => {
  const jobs = read('app/api/jobs/[requestId]/route.js');
  assert.match(jobs, /if \(!attemptIsStuck\(job\)\)/);
  assert.equal((jobs.match(/handleFailover\(\{ job, base, apiKey, updateRows, insertRows \}\)/g) || []).length, 2);
  const gen = read('app/api/generate/route.js');
  assert.match(gen, /primaryModel: providerEndpoint, audioSeconds:/);
  assert.match(gen, /image_url: firstFrame,\n\s+duration: durationSeconds,/);
  const likeness = read('lib/music/likeness.js');
  assert.match(likeness, /KEYFRAME_FALLBACK_MODEL = 'bytedance-seedream-v4\.5-edit'/);
  assert.match(likeness, /STILL_FALLBACK_MODEL = 'nano-banana'/);
  assert.equal((likeness.match(/return withFallback\(/g) || []).length, 2);
  const mig = read('supabase/migrations/20261020165118_reliable_models.sql');
  assert.match(mig, /'seedance-v1\.5-pro-i2v-fast', 'video', 13/);
  assert.match(mig, /'veed-lipsync', 'lip_sync', 3/);
});

test('the export caps decoder threads so long songs never hit the thread limit', () => {
  const src = read('lib/exports/render-video.js');
  assert.match(src, /args\.push\('-threads', '1', '-i', clip\.file\)/);
  assert.match(src, /'-filter_complex_threads', '2'/);
});

test('a failed clean export can be retried with a fresh hold', () => {
  const src = read('app/api/exports/video/route.js');
  assert.match(src, /idempotency_key: `like\.\$\{baseKey\}\*`/);
  assert.match(src, /idempotencyKey = `\$\{baseKey\}:retry-\$\{rows\.length\}`/);
  assert.match(src, /const open = rows\.find\(\(r\) => r\.status === 'reserved'\)/);
});
