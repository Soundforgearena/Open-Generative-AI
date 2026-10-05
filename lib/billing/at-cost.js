// Super admins pay cost, everyone else pays the marked-up price.
//
// "Cost" means the provider's charge plus card fees, so an at-cost job breaks
// even instead of losing money. At-cost usage must be paid with purchased
// credits: bonus credits are free to the user, and spending them on real
// provider bills would lose cash.

import { NET_CENTS_PER_CREDIT } from './director-pricing.js';

export const AT_COST_POLICY = 'at-cost-2026-10-02-v1';

export function isAtCostUser({ superAdmin } = {}) {
  return Boolean(superAdmin) && process.env.SUPER_ADMIN_AT_COST !== 'false';
}

/** Credits that recover a provider cost (in cents) after card fees. Never zero. */
export function atCostCredits(costCents) {
  const cost = Math.max(0, Number(costCents) || 0);
  return Math.max(1, Math.ceil(cost / NET_CENTS_PER_CREDIT - 1e-9));
}

export function isAtCostReservation(reservation) {
  return String(reservation?.pricing_policy_version || '').startsWith('at-cost');
}

/**
 * Credits to settle for a finished generation.
 * - Customers pay the price they confirmed (the full reservation). The quote
 *   already includes the markup; MUAPI's raw cost must never replace it.
 * - At-cost users pay the provider's reported cost (plus fees) when it is
 *   known, never more than they confirmed.
 */
export function settledGenerationCredits(reservation, cost) {
  const max = Number(reservation?.max_reservation_credits) || 0;
  if (!isAtCostReservation(reservation)) return max;
  if (cost?.reliable && Number.isFinite(cost.amountUsdCents) && cost.amountUsdCents !== null) {
    return Math.min(max, atCostCredits(cost.amountUsdCents));
  }
  return max;
}
