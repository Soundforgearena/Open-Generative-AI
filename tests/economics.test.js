const test = require('node:test');
const assert = require('node:assert/strict');
const { requiredCustomerCredits, contributionMarginBps, sumDirectCostCents } = require('../lib/billing/cost-model.js');
const { paymentFeeCents } = require('../lib/billing/payment-fee-model.js');
const { settleReservation, releaseReservation } = require('../lib/billing/settlement-engine.js');
const { priceDrift } = require('../lib/billing/muapi-price-monitor.js');
const { validatePackageEconomics } = require('../lib/billing/profitability-guard.js');

test('credit conversion and margin math use integer cents', () => {
  assert.equal(requiredCustomerCredits(100, 6750), 308);
  assert.equal(contributionMarginBps(400, 100), 7500);
  assert.equal(sumDirectCostCents({ muapiActualCostCents: 12, directInfrastructureCostCents: 3, retryRiskReserveCents: 2 }), 17);
});

test('fixed fee drag is visible for small purchases', () => {
  assert.ok(paymentFeeCents(500) / 500 > paymentFeeCents(10000) / 10000);
});

test('settlement cannot exceed reservation and releases the difference', () => {
  const reservation = { amount: 500, status: 'reserved', idempotencyKey: 'x' };
  assert.deepEqual(settleReservation(reservation, 300).releasedCredits, 200);
  assert.equal(releaseReservation(reservation).status, 'released');
  assert.throws(() => settleReservation(reservation, 501));
});

test('provider price drift thresholds are explicit', () => {
  assert.equal(priceDrift(100, 106).severity, 'warning');
  assert.equal(priceDrift(100, 120).severity, 'critical');
});

test('pack publication blocks below the hard floor', () => {
  assert.equal(validatePackageEconomics({ priceCents: 1000, creditsGranted: 1000, worstCaseCostCents: 400 }).status, 'BLOCKED');
  assert.equal(validatePackageEconomics({ priceCents: 1000, creditsGranted: 1000, worstCaseCostCents: 200 }).status, 'PASS');
});
