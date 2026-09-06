// Allocates Stripe processing fees across purchases so real net-of-fee margin
// can be computed. Pure functions only; DB writes happen in the caller.

import { MARGIN_POLICY } from './margin-policy.js';

/**
 * Stripe's fee for a single charge, per the configured fee model.
 * This is an estimate for pre-settlement UI; actual fees always come from the
 * Stripe balance transaction once available (see payment_fee_records).
 */
export function estimateStripeFeeCents(amountCents) {
  const { fixedFeeCents, variableRateBps } = MARGIN_POLICY.paymentFeeModel;
  if (!Number.isFinite(amountCents) || amountCents < 0) {
    throw new Error('amountCents must be a non-negative number.');
  }
  return Math.round(amountCents * (variableRateBps / 10000)) + fixedFeeCents;
}

/**
 * Reconcile an actual Stripe balance-transaction fee against the purchase,
 * amortized per credit so downstream margin math uses real fee data.
 */
export function allocateActualFeePerCredit({ feeCents, creditsGranted }) {
  if (!Number.isFinite(feeCents) || feeCents < 0) {
    throw new Error('feeCents must be a non-negative number.');
  }
  if (!Number.isInteger(creditsGranted) || creditsGranted <= 0) {
    throw new Error('creditsGranted must be a positive integer.');
  }
  const perCreditCents = feeCents / creditsGranted;
  return {
    feeCents,
    creditsGranted,
    allocatedFeeCentsPerCredit: perCreditCents,
  };
}
