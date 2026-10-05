export const CREDIT_USD_VALUE_CENTS = 1;
export const CUSTOMER_CREDIT_PACKS = [
  { id: 'starter', name: 'Starter', priceCents: 1000, creditsGranted: 1000, bonusCredits: 0 },
  { id: 'creator', name: 'Creator', priceCents: 2500, creditsGranted: 2550, bonusCredits: 50 },
  { id: 'studio', name: 'Studio', priceCents: 5000, creditsGranted: 5200, bonusCredits: 200 },
  { id: 'pro', name: 'Pro', priceCents: 10000, creditsGranted: 10800, bonusCredits: 800 },
  { id: 'agency', name: 'Agency', priceCents: 25000, creditsGranted: 28000, bonusCredits: 3000 },
];

/** Monthly plans (must match billing_plans in the database). Credits roll over. */
export const CUSTOMER_SUBSCRIPTION_PLANS = [
  { id: 'creator', name: 'Creator', priceCents: 1900, creditsGranted: 1950 },
  { id: 'studio', name: 'Studio', priceCents: 4900, creditsGranted: 5150 },
  { id: 'pro', name: 'Pro', priceCents: 9900, creditsGranted: 10900 },
];
