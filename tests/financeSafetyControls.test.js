const test = require('node:test');
const assert = require('node:assert/strict');

const { usableProviderCapacity, evaluateProviderExposure } = require('../lib/billing/provider-exposure-guard.js');
const { evaluateReservationRisk, RISK_THRESHOLDS } = require('../lib/billing/risk-policy.js');
const { estimateStripeFeeCents, allocateActualFeePerCredit } = require('../lib/billing/fee-allocation.js');
const { planChargebackResponse } = require('../lib/billing/chargeback-handler.js');

test('provider exposure blocks a reservation above the remaining capacity', () => {
  const result = evaluateProviderExposure({
    trailingRevenueCents: 100000,
    outstandingReservedCreditsUsdCents: 30000,
    requestedCents: 10000,
  });
  assert.equal(result.decision, 'blocked');
  assert.equal(result.reason, 'PROVIDER_EXPOSURE_LIMIT');
});

test('provider exposure allows a reservation within capacity', () => {
  const result = evaluateProviderExposure({
    trailingRevenueCents: 100000,
    outstandingReservedCreditsUsdCents: 1000,
    requestedCents: 500,
  });
  assert.equal(result.decision, 'allowed');
  assert.equal(usableProviderCapacity({ trailingRevenueCents: 100000, outstandingReservedCreditsUsdCents: 1000 }).capCents, 35000);
});

test('risk policy blocks accounts with a chargeback on file', () => {
  const result = evaluateReservationRisk({ chargebackCount: 1 }, 100);
  assert.equal(result.decision, 'blocked');
  assert.ok(result.flags.includes('CHARGEBACK_ON_FILE'));
});

test('risk policy caps spend for very new accounts', () => {
  const result = evaluateReservationRisk(
    { accountAgeHours: 1, openReservationsCount: 0, reservedCreditsLastHour: 0, chargebackCount: 0 },
    RISK_THRESHOLDS.newAccountMaxReservationCredits + 1
  );
  assert.equal(result.decision, 'blocked');
  assert.ok(result.flags.includes('NEW_ACCOUNT_SPEND_LIMIT_EXCEEDED'));
});

test('risk policy allows an established account within limits', () => {
  const result = evaluateReservationRisk(
    { accountAgeHours: 500, openReservationsCount: 1, reservedCreditsLastHour: 0, chargebackCount: 0 },
    1000
  );
  assert.equal(result.decision, 'allowed');
});

test('fee allocation estimates and reconciles Stripe fees', () => {
  assert.equal(estimateStripeFeeCents(1000), 59);
  const allocation = allocateActualFeePerCredit({ feeCents: 59, creditsGranted: 100 });
  assert.equal(allocation.allocatedFeeCentsPerCredit, 0.59);
});

test('chargeback handler claws back unused credits on refund', () => {
  const plan = planChargebackResponse({
    kind: 'refund',
    creditsGrantedForPayment: 500,
    creditsAlreadyConsumed: 200,
  });
  assert.equal(plan.clawBackCredits, 300);
  assert.equal(plan.flagAccount, false);
});

test('chargeback handler freezes credits and flags the account on dispute open', () => {
  const plan = planChargebackResponse({
    kind: 'dispute_created',
    creditsGrantedForPayment: 500,
    creditsAlreadyConsumed: 500,
  });
  assert.equal(plan.clawBackCredits, 0);
  assert.equal(plan.flagAccount, true);
});

test('chargeback handler restores credits when a dispute is won', () => {
  const plan = planChargebackResponse({
    kind: 'dispute_closed',
    disputeStatus: 'won',
    creditsGrantedForPayment: 500,
    creditsAlreadyConsumed: 100,
  });
  assert.equal(plan.restoreCredits, 400);
  assert.equal(plan.flagAccount, false);
});

test('chargeback handler keeps clawback and flag when a dispute is lost', () => {
  const plan = planChargebackResponse({
    kind: 'dispute_closed',
    disputeStatus: 'lost',
    creditsGrantedForPayment: 500,
    creditsAlreadyConsumed: 100,
  });
  assert.equal(plan.clawBackCredits, 400);
  assert.equal(plan.flagAccount, true);
});
