import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  DIRECTOR_MARGIN_BPS,
  DIRECTOR_TOKEN_BUDGET,
  NET_CENTS_PER_CREDIT,
  creditsForCost,
  maxDirectorCredits,
  ratesFor,
  settledDirectorCredits,
  tokenCostCents,
} from '../lib/billing/director-pricing.js';

const route = () => readFile(new URL('../app/api/director/route.js', import.meta.url), 'utf8');
const marginOf = (credits, costCents) => (credits * NET_CENTS_PER_CREDIT - costCents) / (credits * NET_CENTS_PER_CREDIT);

test('token cost matches OpenAI list prices (gpt-5: $1.25 in / $10 out per 1M)', () => {
  assert.equal(tokenCostCents('gpt-5', { inputTokens: 1_000_000, outputTokens: 0 }), 125);
  assert.equal(tokenCostCents('gpt-5', { inputTokens: 0, outputTokens: 1_000_000 }), 1000);
  assert.equal(tokenCostCents('gpt-5', { inputTokens: 1_000_000, cachedTokens: 1_000_000 }), 12.5);
  assert.deepEqual(ratesFor('gpt-5-mini-2025-08-07').rates, [0.25, 0.025, 2]);
  assert.deepEqual(ratesFor('gpt-5.5').rates, [5, 0.5, 30]);
});

test('net revenue per credit accounts for card fees and pack bonuses', () => {
  assert.ok(NET_CENTS_PER_CREDIT > 0.8 && NET_CENTS_PER_CREDIT < 0.95);
});

test('every Director price keeps at least the platform margin, even at the worst case', () => {
  for (const model of ['gpt-5', 'gpt-5-mini', 'gpt-5.5', 'gpt-6-sol', 'gpt-6-astra', 'unknown-model']) {
    for (const kind of ['assist', 'plan']) {
      const b = DIRECTOR_TOKEN_BUDGET[kind];
      const worst = tokenCostCents(model, { inputTokens: b.input, outputTokens: b.output });
      const max = maxDirectorCredits(kind, model);
      assert.ok(marginOf(max, worst) >= DIRECTOR_MARGIN_BPS / 10000 - 1e-9, `${model} ${kind}`);
    }
  }
});

test('users are charged for actual usage, never above the shown maximum, with margin intact', () => {
  const usage = { input_tokens: 1400, output_tokens: 700, input_tokens_details: { cached_tokens: 0 } };
  const charged = settledDirectorCredits('assist', 'gpt-5', usage);
  assert.ok(charged < maxDirectorCredits('assist', 'gpt-5'));
  assert.ok(marginOf(charged, tokenCostCents('gpt-5', { inputTokens: 1400, outputTokens: 700 })) >= DIRECTOR_MARGIN_BPS / 10000 - 1e-9);
  assert.equal(settledDirectorCredits('assist', 'gpt-5', { input_tokens: 1e7, output_tokens: 1e7 }), maxDirectorCredits('assist', 'gpt-5'));
  assert.equal(settledDirectorCredits('assist', 'gpt-5', null), maxDirectorCredits('assist', 'gpt-5'));
  assert.ok(creditsForCost(0) >= 1, 'the Director is never free');
});

test('unknown models are priced conservatively', () => {
  assert.equal(ratesFor('mystery').known, false);
  assert.ok(maxDirectorCredits('assist', 'mystery') >= maxDirectorCredits('assist', 'gpt-6-astra'));
});

test('Director spends purchased credits only and never runs without a reservation', async () => {
  const src = await route();
  assert.match(src, /reserve_paid_credits_v1/);
  assert.doesNotMatch(src, /'reserve_credits_v2'/);
  assert.match(src, /settle_reservation_v2/);
  assert.match(src, /release_reservation_v2/);
  assert.match(src, /settledDirectorCredits\(kind, DIRECTOR_MODEL, outcome\.usage\)/);
  assert.match(src, /INSUFFICIENT_PAID_CREDITS/);
  assert.match(src, /max_output_tokens: budget\.output/);
  assert.match(src, /effort: 'low'/);
  const post = src.slice(src.indexOf('export async function POST'));
  assert.match(post, /charge\('assist'/);
  assert.match(post, /charge\('plan'/);
  assert.match(post, /platformFunded \? runPlatformFunded\(user, kind, run\) : chargeDirector\(user, kind, key, run\)/);
});

test('paid-only reservation refuses bonus credits in the database', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20261002200000_director_paid_credits_only.sql', import.meta.url), 'utf8');
  assert.match(sql, /least\(v_balance, v_paid_available\) < p_max_reservation_credits/);
  assert.match(sql, /INSUFFICIENT_PAID_CREDITS/);
  assert.match(sql, /v_to_allocate := p_max_reservation_credits/);
  assert.match(sql, /grant execute on function public\.reserve_paid_credits_v1[^;]*to service_role/);
  assert.match(sql, /revoke all on function public\.reserve_paid_credits_v1[^;]*authenticated/);
});
