import { validatePackageEconomics } from './profitability-guard.js';
import { paymentFeeCents } from './payment-fee-model.js';

export const CREDIT_PACKS = [
  { id: 'starter', name: 'Starter', priceCents: 1000, creditsGranted: 1000, bonusCredits: 0 },
  { id: 'creator', name: 'Creator', priceCents: 2500, creditsGranted: 2550, bonusCredits: 50 },
  { id: 'studio', name: 'Studio', priceCents: 5000, creditsGranted: 5200, bonusCredits: 200 },
  { id: 'pro', name: 'Pro', priceCents: 10000, creditsGranted: 10800, bonusCredits: 800 },
  { id: 'agency', name: 'Agency', priceCents: 25000, creditsGranted: 28000, bonusCredits: 3000 },
];

export function simulatePack(pack, scenarioCostCents, feeModel) {
  const feeCents = paymentFeeCents(pack.priceCents, feeModel);
  const netCents = pack.priceCents - feeCents;
  return { ...pack, feeCents, netCents, effectiveRevenuePerCreditCents: netCents / pack.creditsGranted, ...validatePackageEconomics({ priceCents: netCents, creditsGranted: pack.creditsGranted, worstCaseCostCents: scenarioCostCents }) };
}
