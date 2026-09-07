import { MARGIN_POLICY } from './margin-policy.js';
import { contributionMarginBps } from './cost-model.js';

export function assertMinimumMargin(customerCredits, loadedCostCents, { override = false } = {}) {
  const marginBps = contributionMarginBps(customerCredits, loadedCostCents);
  if (marginBps < MARGIN_POLICY.minimumContributionMarginBps && !override) {
    const error = new Error('Operation is below the minimum contribution margin.');
    error.code = 'MARGIN_FLOOR_BLOCKED';
    throw error;
  }
  return { marginBps, overridden: marginBps < MARGIN_POLICY.minimumContributionMarginBps };
}

export function validatePackageEconomics({ priceCents, creditsGranted, worstCaseCostCents }) {
  const marginBps = contributionMarginBps(priceCents, worstCaseCostCents);
  return { marginBps, status: marginBps < 6500 ? 'BLOCKED' : marginBps < 6750 ? 'WARNING' : 'PASS' };
}
