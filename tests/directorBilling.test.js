import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DIRECTOR_CREDIT_COSTS, DIRECTOR_MAX_OUTPUT_TOKENS, directorCost } from '../lib/billing/director-pricing.js';

const route = () => readFile(new URL('../app/api/director/route.js', import.meta.url), 'utf8');

test('the AI Director is never free', () => {
  assert.ok(DIRECTOR_CREDIT_COSTS.assist >= 1);
  assert.ok(DIRECTOR_CREDIT_COSTS.plan > DIRECTOR_CREDIT_COSTS.assist);
  process.env.DIRECTOR_ASSIST_CREDITS = '0';
  assert.equal(directorCost('assist'), DIRECTOR_CREDIT_COSTS.assist);
  process.env.DIRECTOR_ASSIST_CREDITS = '12';
  assert.equal(directorCost('assist'), 12);
  delete process.env.DIRECTOR_ASSIST_CREDITS;
});

test('worst-case model spend stays below the price (gpt-5 output ≈ $10 per 1M tokens, 1 credit = 1 cent)', () => {
  const worstCents = (tokens) => (tokens / 1_000_000) * 1000 + 1; // output + ~1c input allowance
  assert.ok(worstCents(DIRECTOR_MAX_OUTPUT_TOKENS.assist) < DIRECTOR_CREDIT_COSTS.assist * 0.9);
  assert.ok(worstCents(DIRECTOR_MAX_OUTPUT_TOKENS.plan) < DIRECTOR_CREDIT_COSTS.plan * 0.9);
});

test('every Director call reserves credits before the model runs and releases them on failure', async () => {
  const src = await route();
  assert.match(src, /reserve_credits_v2/);
  assert.match(src, /settle_reservation_v2/);
  assert.match(src, /release_reservation_v2/);
  assert.match(src, /chargeDirector\(user, 'assist'/);
  assert.match(src, /chargeDirector\(user, 'plan'/);
  assert.match(src, /INSUFFICIENT_CREDITS/);
  assert.match(src, /status: 402/);
  assert.match(src, /max_output_tokens/);
  assert.doesNotMatch(src, /writing help is free/i);
  // the model is only reachable through the charging wrapper
  const post = src.slice(src.indexOf('export async function POST'));
  assert.doesNotMatch(post.replace(/chargeDirector\([^]*?\)\);/g, ''), /handleAssist\(body\)/);
});
