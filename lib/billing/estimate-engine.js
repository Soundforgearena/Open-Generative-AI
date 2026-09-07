import { MARGIN_POLICY, targetMarginBps } from './margin-policy.js';
import { buildLoadedCost, contributionMarginBps, requiredCustomerCredits } from './cost-model.js';

export function estimateOperation({ operation, model = 'configured-model', muapiEstimateCents, otherDirectProviderCostCents = 0, units = 1, availableCredits = 0, assumptions = [] }) {
  if (!Number.isFinite(muapiEstimateCents) || muapiEstimateCents < 0) throw new Error('A verified provider estimate is required.');
  const overhead = (MARGIN_POLICY.directOverheadByOperation[operation] || 0) * units;
  const risk = (MARGIN_POLICY.riskReserveByOperation[operation] || 0) * units;
  const loaded = buildLoadedCost({ muapiActualCostCents: Math.round(muapiEstimateCents), directInfrastructureCostCents: overhead, retryRiskReserveCents: risk, otherDirectProviderCostCents });
  const marginTarget = targetMarginBps(operation);
  const estimatedCredits = requiredCustomerCredits(loaded.fullyLoadedDirectCostCents, marginTarget);
  const maximumReservationCredits = Math.ceil(estimatedCredits * (100 + MARGIN_POLICY.defaultReservationBufferPercent) / 100);
  return { estimateId: `estimate-${Date.now()}`, expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(), pricingPolicyVersion: MARGIN_POLICY.version, operation, model, estimatedCredits, maximumReservationCredits, currentAvailableCredits: availableCredits, currentReservedCredits: 0, availableAfterReservation: availableCredits - maximumReservationCredits, warnings: availableCredits < maximumReservationCredits ? ['Insufficient available credits.'] : [], assumptions, userExplanation: 'Your estimate is based on the selected model, duration, quality, and project settings. We reserve up to the maximum shown. Any unused reserved credits are released after the job completes.' };
}

export function validateEstimateMargin(estimate, directCostCents, operation) { const margin = contributionMarginBps(estimate.estimatedCredits, directCostCents); return { marginBps: margin, passesMinimum: margin >= (MARGIN_POLICY.operationTargetsBps[operation] || MARGIN_POLICY.minimumContributionMarginBps) }; }
