// Creator Vault storage plans (future state). Priced so each plan covers the
// storage provider's cost, bandwidth for viewers and payment fees, with a
// healthy margin. Prices are monthly and charged in credits (1 credit = $0.01).

export const STORAGE_PLANS = [
  { code: 'vault_25', name: 'Starter Vault', gb: 25, monthly_cents: 299, blurb: 'About 50 finished 1080p episodes' },
  { code: 'vault_100', name: 'Creator Vault', gb: 100, monthly_cents: 799, blurb: 'A full season with room for drafts', featured: true },
  { code: 'vault_500', name: 'Studio Vault', gb: 500, monthly_cents: 2499, blurb: 'Multiple series and every take' },
  { code: 'vault_2000', name: 'Network Vault', gb: 2000, monthly_cents: 7999, blurb: 'For channels publishing weekly' },
];

/**
 * Margin check for a plan given the provider's cost per GB-month and an
 * allowance for viewer bandwidth. Used by tests and the admin cockpit.
 */
export function planMargin(plan, { costPerGbMonthCents = 1.5, egressAllowanceCents = 0, feeRate = 0.059, feeFixedCents = 30 } = {}) {
  const cost = plan.gb * costPerGbMonthCents + egressAllowanceCents;
  const fees = plan.monthly_cents * feeRate + feeFixedCents;
  const profit = plan.monthly_cents - cost - fees;
  return { cost: Math.round(cost), fees: Math.round(fees), profit: Math.round(profit), margin: profit / plan.monthly_cents };
}
