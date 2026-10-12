// Bounds how much unsettled reservation exposure the platform allows against
// a single provider before new reservations are queued or blocked. Pure
// function: caller supplies current totals, no DB access here.

const DEFAULT_MAX_EXPOSURE_RATIO = 0.35; // fraction of trailing revenue

// Owner-controlled starting allowance: the platform may float this much
// unsettled provider exposure even before real revenue exists, so the very
// first generations can run. Stored in app_settings.provider_exposure_floor
// as { cents }. Hard-capped so a typo can never open the floodgates.
export const DEFAULT_EXPOSURE_FLOOR_CENTS = 500; // $5
export const MAX_EXPOSURE_FLOOR_CENTS = 5000; // $50

export function normalizeExposureFloorCents(value) {
  if (value === undefined || value === null) return DEFAULT_EXPOSURE_FLOOR_CENTS;
  const raw = typeof value === 'object' ? value.cents : value;
  if (raw === undefined || raw === null || raw === '') return DEFAULT_EXPOSURE_FLOOR_CENTS;
  const numeric = Number(raw);
  if (!Number.isFinite(numeric) || numeric < 0) return 0;
  return Math.min(MAX_EXPOSURE_FLOOR_CENTS, Math.round(numeric));
}

export function usableProviderCapacity({
  trailingRevenueCents,
  outstandingReservedCreditsUsdCents,
  maxExposureRatio = DEFAULT_MAX_EXPOSURE_RATIO,
  floorCents = 0,
}) {
  if (!Number.isFinite(trailingRevenueCents) || trailingRevenueCents < 0) {
    throw new Error('trailingRevenueCents must be a non-negative number.');
  }
  const floor = Number.isFinite(floorCents) && floorCents > 0
    ? Math.min(MAX_EXPOSURE_FLOOR_CENTS, Math.round(floorCents))
    : 0;
  const capCents = Math.max(Math.round(trailingRevenueCents * maxExposureRatio), floor);
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
  floorCents,
}) {
  const capacity = usableProviderCapacity({
    trailingRevenueCents,
    outstandingReservedCreditsUsdCents,
    maxExposureRatio,
    floorCents,
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
