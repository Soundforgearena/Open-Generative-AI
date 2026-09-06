export function sumDirectCostCents({ muapiActualCostCents = 0, allocatedPaymentFeeCents = 0, directInfrastructureCostCents = 0, retryRiskReserveCents = 0, otherDirectProviderCostCents = 0 }) {
  return [muapiActualCostCents, allocatedPaymentFeeCents, directInfrastructureCostCents, retryRiskReserveCents, otherDirectProviderCostCents].reduce((sum, value) => sum + Math.max(0, Math.round(Number(value) || 0)), 0);
}

export function contributionMarginBps(customerPriceCents, directCostCents) {
  if (customerPriceCents <= 0) return 0;
  return Math.floor(((customerPriceCents - directCostCents) * 10000) / customerPriceCents);
}

export function requiredCustomerCredits(directCostCents, marginBps) {
  if (marginBps >= 10000) throw new Error('Margin must be below 100%.');
  return Math.ceil((directCostCents * 10000) / (10000 - marginBps));
}

export function buildLoadedCost(input) {
  return { ...input, fullyLoadedDirectCostCents: sumDirectCostCents(input) };
}
