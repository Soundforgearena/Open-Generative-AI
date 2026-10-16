import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ensureSungMinimum, MIN_SUNG_MS, timelineToScenes } from '../lib/music/lyrics.js';
import { activePlanCode, creditsAtMargin, planCredits, PLAN_MARGIN_PERCENT } from '../lib/billing/plan-pricing.js';
import { providerCostCents } from '../lib/billing/provider-pricing.js';

const RULE = { provider_cost_cents: 3.3, fixed_overhead_cents: 0.25, variable_overhead_percent: 5, payment_fee_fixed_cents: 0.3, payment_fee_percent: 3.5, minimum_customer_price_cents: 2 };
const sung = (a, b, v = 'a') => ({ start_ms: a, end_ms: b, lip_sync: true, vocalist: v, lyric_text: `${a}` });
const broll = (a, b) => ({ start_ms: a, end_ms: b, lip_sync: false });

test('short sung scenes borrow time from b-roll and reach 5 s', () => {
  const out = ensureSungMinimum([sung(0, 3000), broll(3000, 9000)]);
  assert.equal(out[0].end_ms - out[0].start_ms, MIN_SUNG_MS);
  assert.equal(out[1].start_ms, MIN_SUNG_MS);
});

test('b-roll left too short is absorbed and zero-length scenes are dropped', () => {
  const out = ensureSungMinimum([sung(0, 3000), broll(3000, 4000), sung(4000, 6000)]);
  assert.ok(out.every((s) => s.end_ms > s.start_ms));
  assert.ok(out.filter((s) => s.lip_sync).every((s) => s.end_ms - s.start_ms >= MIN_SUNG_MS));
});

test('neighbouring short lines by the same singer merge; different singers do not', () => {
  const same = ensureSungMinimum([sung(0, 3000), sung(3000, 6000)]);
  assert.equal(same.length, 1);
  assert.equal(same[0].lyric_text, '0 / 3000');
  const diff = ensureSungMinimum([sung(0, 3000, 'a'), sung(3000, 9000, 'b')]);
  assert.equal(diff.length, 2);
  assert.equal(diff[1].vocalist, 'b');
});

test('the scene timeline never loses song time', () => {
  const out = ensureSungMinimum([broll(0, 2000), sung(2000, 4500), broll(4500, 7000), sung(7000, 11000), sung(11000, 12500)]);
  assert.equal(out[0].start_ms, 0);
  assert.equal(out.at(-1).end_ms, 12500);
  for (let i = 1; i < out.length; i += 1) assert.equal(out[i].start_ms, out[i - 1].end_ms);
});

test('b-roll can use a lower resolution than the singing shots', () => {
  const scenes = timelineToScenes([sung(0, 5000), broll(5000, 9000)], { resolution: '1080p', brollResolution: '720p' });
  assert.match(scenes[0].shot_direction, /1080p/);
  assert.match(scenes[1].shot_direction, /720p/);
});

test('plan pricing uses the same formula as the database quote', () => {
  // pixverse 1080p 6 s: provider cost 71.4 cents -> 240 credits at the 65% list margin.
  assert.equal(creditsAtMargin(RULE, 71.4, 65), 240);
  const studio = planCredits({ rule: RULE, providerCostCents: 71.4, listCredits: 240, planCode: 'studio' });
  assert.ok(studio < 240);
  // Still profitable: the price covers cost, overhead and card fees at the plan margin.
  const cost = 71.4 + 0.25 + 71.4 * 0.05;
  const net = studio * (1 - 0.035) - 0.3;
  assert.ok((net - cost) / studio >= PLAN_MARGIN_PERCENT.studio / 100 - 0.01);
  assert.equal(planCredits({ rule: RULE, providerCostCents: 71.4, listCredits: 240, planCode: null }), null);
});

test('only live subscriptions earn the subscriber price', () => {
  assert.equal(activePlanCode([]), null);
  assert.equal(activePlanCode([{ plan_code: 'studio', status: 'canceled' }]), null);
  assert.equal(activePlanCode([{ plan_code: 'studio', status: 'active', current_period_end: '2000-01-01T00:00:00Z' }]), null);
  assert.equal(activePlanCode([{ plan_code: 'creator', status: 'active' }, { plan_code: 'pro', status: 'trialing' }]), 'pro');
});

test('one-step singing is priced per second with a 5 s minimum', () => {
  assert.equal(providerCostCents({ model: 'omnihuman-1-5', operation: 'video', durationSeconds: 8, resolution: '1080p', ruleCostCents: 22.5 }), 48);
  assert.equal(providerCostCents({ model: 'omnihuman-1-5', operation: 'video', durationSeconds: 3, resolution: '720p', ruleCostCents: 0 }), 22.5);
});

test('animating needs an approved still and the migration adds the new rules hidden', () => {
  const route = readFileSync(new URL('../app/api/generate/route.js', import.meta.url), 'utf8');
  assert.match(route, /keyframe_approved !== true/);
  assert.match(route, /runStillJob/);
  const sql = readFileSync(new URL('../supabase/migrations/20261016150000_stills_and_performance.sql', import.meta.url), 'utf8');
  for (const m of ['flux-krea-dev', 'nano-banana-2-edit', 'omnihuman-1-5']) assert.match(sql, new RegExp(m));
  assert.doesNotMatch(sql, /[^_]customer_price_cents/);
  assert.doesNotMatch(sql, /, true, '/);
});

test('sung performances send at least 5.2 s of audio, padded only at the end, and are priced on it', () => {
  const route = readFileSync(new URL('../app/api/generate/route.js', import.meta.url), 'utf8');
  assert.match(route, /Math\.max\(windowMs, PERFORM_AUDIO_MIN_MS\)/);
  assert.match(route, /minMs: perform\.audioMs/);
  const audio = readFileSync(new URL('../lib/music/audio.js', import.meta.url), 'utf8');
  assert.match(audio, /apad=whole_dur=\$\{\(end \/ 1000\)/);
  const jobs = readFileSync(new URL('../app/api/jobs/[requestId]/route.js', import.meta.url), 'utf8');
  assert.match(jobs, /provider_failed\$\{providerReason/);
});

test('the singing prompt stays short enough for the model', async () => {
  const { performPrompt, PERFORM_PROMPT_MAX } = await import('../lib/music/likeness.js');
  assert.ok(performPrompt('a very long lyric line '.repeat(40)).length <= PERFORM_PROMPT_MAX);
});
