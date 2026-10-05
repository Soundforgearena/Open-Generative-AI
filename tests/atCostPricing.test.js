import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { atCostCredits, isAtCostUser, settledGenerationCredits, AT_COST_POLICY } from '../lib/billing/at-cost.js';
import { providerCostCents } from '../lib/billing/provider-pricing.js';
import { NET_CENTS_PER_CREDIT, maxDirectorCredits, creditsForCost } from '../lib/billing/director-pricing.js';

const src = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('MUAPI video cost scales with duration and resolution (PixVerse V6: $0.059/s at 720p)', () => {
  assert.equal(providerCostCents({ model: 'pixverse-v6-t2v', operation: 'video', durationSeconds: 10, resolution: '720p', ruleCostCents: 3.3 }), 59);
  assert.equal(providerCostCents({ model: 'pixverse-v6', operation: 'video', durationSeconds: 5, resolution: '1080p', ruleCostCents: 3.3 }), 59.5);
  assert.equal(providerCostCents({ model: 'pixverse-v6-t2v', operation: 'video', durationSeconds: 5, resolution: '8k', ruleCostCents: 0 }), 59.5, 'unknown resolution is priced at the top tier');
  assert.equal(providerCostCents({ model: 'flux.1-schnell', operation: 'image', ruleCostCents: 0.3 }), 0.3);
});

test('only super admins pay cost', () => {
  assert.equal(isAtCostUser({ superAdmin: true }), true);
  assert.equal(isAtCostUser({ superAdmin: false }), false);
  process.env.SUPER_ADMIN_AT_COST = 'false';
  assert.equal(isAtCostUser({ superAdmin: true }), false);
  delete process.env.SUPER_ADMIN_AT_COST;
});

test('at cost recovers provider cost and card fees, never zero, never a loss', () => {
  assert.equal(atCostCredits(0), 1);
  const credits = atCostCredits(59);
  assert.ok(credits * NET_CENTS_PER_CREDIT >= 59);
  assert.ok((credits - 1) * NET_CENTS_PER_CREDIT < 59);
});

test('super admins pay less than customers for the Director, but still cover cost', () => {
  const customer = maxDirectorCredits('assist', 'gpt-5');
  const admin = maxDirectorCredits('assist', 'gpt-5', { atCost: true });
  assert.ok(admin < customer);
  assert.ok(creditsForCost(2.4375, { atCost: true }) * NET_CENTS_PER_CREDIT >= 2.4375);
});

test('customers always pay the confirmed price; MUAPI raw cost never replaces the markup', () => {
  const customer = { max_reservation_credits: 120, pricing_policy_version: '2026-09-06-v1' };
  assert.equal(settledGenerationCredits(customer, { reliable: true, amountUsdCents: 59 }), 120);
  const admin = { max_reservation_credits: 80, pricing_policy_version: AT_COST_POLICY };
  assert.equal(settledGenerationCredits(admin, { reliable: true, amountUsdCents: 40 }), atCostCredits(40));
  assert.equal(settledGenerationCredits(admin, { reliable: true, amountUsdCents: 999 }), 80);
  assert.equal(settledGenerationCredits(admin, { reliable: false, amountUsdCents: null }), 80);
});

test('generate route prices real cost, charges admins at cost from purchased credits only', async () => {
  const gen = await src('app/api/generate/route.js');
  assert.match(gen, /p_provider_cost_cents: jobCostCents/);
  assert.match(gen, /atCost \? atCostCredits\(jobCostCents\) : Number\(quoteRow\.credits\)/);
  assert.match(gen, /atCost \? 'reserve_paid_credits_v1' : 'reserve_credits_v2'/);
  assert.doesNotMatch(gen, /platformFunded/);
  for (const path of ['app/api/jobs/[requestId]/route.js', 'app/api/admin/cron/reconcile/route.js']) {
    const s = await src(path);
    assert.match(s, /settledGenerationCredits\(reservation, /, path);
    assert.doesNotMatch(s, /amountCredits\)/, path);
  }
  const pricing = await src('app/api/pricing/route.js');
  assert.match(pricing, /providerCostCents\(/);
});
