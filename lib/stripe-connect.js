import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
});

/**
 * Create a Stripe Connect Express account for a revenue partner.
 * @param {Object} params
 * @param {string} params.email - Partner email
 * @param {string} params.partnerId - revenue_partners.id
 * @param {string} params.displayName - Partner display name
 * @returns {Promise<{accountId: string, onboardingUrl: string}>}
 */
export async function createExpressAccount({ email, partnerId, displayName }) {
  const account = await stripe.accounts.create({
    type: 'express',
    email,
    business_type: 'individual',
    capabilities: {
      transfers: { requested: true },
    },
    metadata: {
      cinexvideo_partner_id: partnerId,
      partner_email: email,
      partner_display_name: displayName,
    },
  });

  const accountLink = await stripe.accountLinks.create({
    account: account.id,
    refresh_url: `${process.env.NEXT_PUBLIC_APP_URL}/billing/connect?refresh=true`,
    return_url: `${process.env.NEXT_PUBLIC_APP_URL}/billing/connect?success=true`,
    type: 'account_onboarding',
  });

  return {
    accountId: account.id,
    onboardingUrl: accountLink.url,
  };
}

/**
 * Fetch an Express account's onboarding status.
 * @param {string} accountId - Stripe account ID
 * @returns {Promise<{detailsSubmitted: boolean, chargesEnabled: boolean, payoutsEnabled: boolean}>}
 */
export async function getAccountStatus(accountId) {
  const account = await stripe.accounts.retrieve(accountId);
  return {
    detailsSubmitted: account.details_submitted,
    chargesEnabled: account.charges_enabled,
    payoutsEnabled: account.payouts_enabled,
  };
}

/**
 * Create a payout (transfer) to an Express account.
 * @param {Object} params
 * @param {string} params.destination - Stripe account ID
 * @param {number} params.amountCents - Amount in cents
 * @param {string} params.partnerId - revenue_partners.id for metadata
 * @returns {Promise<Stripe.Transfer>}
 */
export async function createPayout({ destination, amountCents, partnerId }) {
  return stripe.transfers.create({
    amount: amountCents,
    currency: 'usd',
    destination,
    metadata: {
      cinexvideo_partner_id: partnerId,
    },
  });
}

export { stripe };
