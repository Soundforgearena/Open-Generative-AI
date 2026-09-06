const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CONTRACTOR_MAX_PAYOUT_CENTS,
  CONTRACTOR_UNIT_ALLOCATION,
  TOTAL_CONTRACTOR_UNITS,
  calculateMonthlyContractorPayouts,
  payoutPeriodBounds,
} = require('../lib/contractor-payouts.js');

test('contractor allocation has the configured 59 total units', () => {
  assert.equal(TOTAL_CONTRACTOR_UNITS, 59);
  assert.equal(CONTRACTOR_UNIT_ALLOCATION.length, 6);
});

test('monthly payout calculation keeps half of revenue for contractors', () => {
  const result = calculateMonthlyContractorPayouts({ totalRevenueCents: 1_000_000 });
  assert.equal(result.contractorPoolCents, 500_000);
  assert.equal(result.totalCappedToPlatformCents, 0);
  assert.equal(result.payouts.reduce((sum, payout) => sum + payout.cappedShareCents, 0), 500_000);
});

test('monthly payout calculation applies the five-thousand-dollar cap', () => {
  const result = calculateMonthlyContractorPayouts({ totalRevenueCents: 100_000_000 });
  assert.ok(result.payouts.every((payout) => payout.cappedShareCents <= CONTRACTOR_MAX_PAYOUT_CENTS));
  assert.ok(result.totalCappedToPlatformCents > 0);
});

test('payout periods reject malformed values and calculate the next month', () => {
  assert.deepEqual(payoutPeriodBounds('2026-12'), {
    period: '2026-12',
    start: '2026-12-01T00:00:00.000Z',
    end: '2027-01-01T00:00:00.000Z',
  });
  assert.throws(() => payoutPeriodBounds('2026-13'), /YYYY-MM/);
  assert.throws(() => payoutPeriodBounds('September 2026'), /YYYY-MM/);
});
