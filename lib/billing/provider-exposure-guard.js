// Bounds how much unsettled reservation exposure the platform allows against
// a single provider before new reservations are queued or blocked. Pure
// function: caller supplies current totals, no DB access here.

const DEFAULT_MAX_EXPOSURE_RATIO = 0.35; // fraction of trailing revenue

// A server-owned, opt-in allowance for zero-revenue testing only. It is not
// a revenue floor or a per-request budget; all outstanding reservations count.
export const MAX_STARTING_PROVIDER_ALLOWANCE_CENTS = 500;

export function normalizeStartingProviderAllowanceCents(value) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value))) {
    return 0;
  }
  const cents = Number(value);
  if (!Number.isSafeInteger(cents) || cents < 0) return 0;
  return Math.min(MAX_STARTING_PROVIDER_ALLOWANCE_CENTS, cents);
}

export function usableProviderCapacity({
  trailingRevenueCents,
  outstandingReservedCreditsUsdCents,
  maxExposureRatio = DEFAULT_MAX_EXPOSURE_RATIO,
  startingProviderAllowanceCents = 0,
}) {
  if (!Number.isFinite(trailingRevenueCents) || trailingRevenueCents < 0) {
    throw new Error('trailingRevenueCents must be a non-negative number.');
  }
  const capCents = trailingRevenueCents === 0
    ? normalizeStartingProviderAllowanceCents(startingProviderAllowanceCents)
    : Math.round(trailingRevenueCents * maxExposureRatio);
  const usedCents = Math.max(0, Math.round(outstandingReservedCreditsUsdCents || 0));
  return {
    capCents,
    usedCents,
    remainingCents: Math.max(0, capCents - usedCents),
    utilizationRatio: capCents > 0 ? usedCents / capCents : 1,
  };
}

/**
 * Decide whether a new reservation of `requestedCents` should proceed,
 * queue, or be blocked given the current provider exposure.
 */
export function evaluateProviderExposure({
  trailingRevenueCents,
  outstandingReservedCreditsUsdCents,
  requestedCents,
  maxExposureRatio,
  startingProviderAllowanceCents,
}) {
  const capacity = usableProviderCapacity({
    trailingRevenueCents,
    outstandingReservedCreditsUsdCents,
    maxExposureRatio,
    startingProviderAllowanceCents,
  });
  if (!Number.isFinite(requestedCents) || requestedCents < 0) {
    throw new Error('requestedCents must be a non-negative number.');
  }
  if (requestedCents > capacity.remainingCents) {
    return { decision: 'blocked', reason: 'PROVIDER_EXPOSURE_LIMIT', capacity };
  }
  if (capacity.utilizationRatio >= 0.85) {
    return { decision: 'queued', reason: 'PROVIDER_EXPOSURE_NEAR_LIMIT', capacity };
  }
  return { decision: 'allowed', reason: null, capacity };
}
