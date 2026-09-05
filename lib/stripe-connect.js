import Stripe from 'stripe';

const STRIPE_API_VERSION = '2024-06-20';

let cachedStripe = null;
let cachedKey = null;

/**
 * True when a Stripe secret key is present in the environment.
 *
 * Every Stripe-backed route calls this first so the app builds and boots
 * cleanly on deployments where billing has not been configured yet.
 */
export function stripeEnabled() {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

/**
 * Lazily construct the Stripe client.
 *
 * The client is intentionally NOT created at module scope: Next.js evaluates
 * route modules during `next build` (page-data collection), and instantiating
 * Stripe without a key throws "Neither apiKey nor config.authenticator
 * provided", which fails the whole build.
 *
 * @returns {Stripe}
 */
export function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error('Stripe is not configured: STRIPE_SECRET_KEY is missing.');
  }
  if (!cachedStripe || cachedKey !== key) {
    cachedStripe = new Stripe(key, { apiVersion: STRIPE_API_VERSION });
    cachedKey = key;
  }
  return cachedStripe;
}

/**
 * Proxy that behaves like a Stripe client but resolves the real one on first
 * property access, so existing `stripe.accounts.create(...)` call sites keep
 * working without being evaluated at import time.
 */
export const stripe = new Proxy(
  {},
  {
    get(_target, prop) {
      const client = getStripe();
      const value = client[prop];
      return typeof value === 'function' ? value.bind(client) : value;
    },
    has(_target, prop) {
      return prop in getStripe();
    },
  }
);

/* ------------------------------------------------------------------ */
/* Connect / Express accounts                                          */
/* ------------------------------------------------------------------ */

/**
 * Create a Stripe Connect Express account for a revenue partner.
 *
 * @param {Object} params
 * @param {string} params.email
 * @param {string} [params.country] - Two-letter country code, defaults to US.
 * @param {string} [params.businessUrl] - Public site URL shown to the partner.
 * @param {string} [params.partnerId] - revenue_partners.id, stored as metadata.
 * @param {string} [params.displayName]
 * @returns {Promise<Stripe.Account>}
 */
export async function createExpressAccount({
  email,
  country = process.env.STRIPE_PARTNER_COUNTRY || 'US',
  businessUrl,
  partnerId,
  displayName,
} = {}) {
  const metadata = {};
  if (partnerId) metadata.cinexvideo_partner_id = partnerId;
  if (email) metadata.partner_email = email;
  if (displayName) metadata.partner_display_name = displayName;

  return getStripe().accounts.create({
    type: 'express',
    email,
    country,
    business_type: 'individual',
    capabilities: { transfers: { requested: true } },
    ...(businessUrl ? { business_profile: { url: businessUrl } } : {}),
    ...(Object.keys(metadata).length ? { metadata } : {}),
  });
}

/**
 * Create a fresh, single-use Express onboarding link.
 *
 * @param {Object} params
 * @param {string} params.accountId
 * @param {string} params.refreshUrl
 * @param {string} params.returnUrl
 * @returns {Promise<string>} The onboarding URL.
 */
export async function createOnboardingLink({ accountId, refreshUrl, returnUrl }) {
  const link = await getStripe().accountLinks.create({
    account: accountId,
    refresh_url: refreshUrl,
    return_url: returnUrl,
    type: 'account_onboarding',
  });
  return link.url;
}

/**
 * Create a one-time login link to the partner's own Express dashboard.
 *
 * @param {string} accountId
 * @returns {Promise<string>} The dashboard URL.
 */
export async function createDashboardLink(accountId) {
  const link = await getStripe().accounts.createLoginLink(accountId);
  return link.url;
}

/**
 * Retrieve a connected account.
 *
 * @param {string} accountId
 * @returns {Promise<Stripe.Account>}
 */
export async function getAccount(accountId) {
  return getStripe().accounts.retrieve(accountId);
}

/**
 * Flatten a Stripe account into the small shape the cockpit and the partner
 * portal actually render.
 *
 * @param {Stripe.Account} account
 * @returns {{payouts_enabled: boolean, charges_enabled: boolean, details_submitted: boolean, onboarding_status: string, requirements_due: string[]}}
 */
export function summariseAccount(account) {
  if (!account) {
    return {
      payouts_enabled: false,
      charges_enabled: false,
      details_submitted: false,
      onboarding_status: 'not_started',
      requirements_due: [],
    };
  }

  const due = [
    ...(account.requirements?.currently_due || []),
    ...(account.requirements?.past_due || []),
  ];

  let onboarding_status = 'action_required';
  if (account.payouts_enabled && due.length === 0) {
    onboarding_status = 'complete';
  } else if (!account.details_submitted) {
    onboarding_status = 'not_started';
  } else if (account.requirements?.disabled_reason) {
    onboarding_status = 'restricted';
  } else if (due.length === 0) {
    onboarding_status = 'pending_verification';
  }

  return {
    payouts_enabled: Boolean(account.payouts_enabled),
    charges_enabled: Boolean(account.charges_enabled),
    details_submitted: Boolean(account.details_submitted),
    onboarding_status,
    requirements_due: Array.from(new Set(due)),
  };
}

/**
 * Legacy helper kept for older call sites.
 *
 * @param {string} accountId
 */
export async function getAccountStatus(accountId) {
  const account = await getAccount(accountId);
  return {
    detailsSubmitted: Boolean(account.details_submitted),
    chargesEnabled: Boolean(account.charges_enabled),
    payoutsEnabled: Boolean(account.payouts_enabled),
  };
}

/* ------------------------------------------------------------------ */
/* Checkout                                                            */
/* ------------------------------------------------------------------ */

/**
 * Start a hosted Checkout session for a credit pack.
 *
 * Price is taken from the pack record supplied by the caller (which reads it
 * from the database), never from client input.
 *
 * @param {Object} params
 * @param {{code: string, name: string, credits: number, price_cents: number, blurb?: string}} params.pack
 * @param {string} params.userId
 * @param {string} [params.userEmail]
 * @param {string} params.successUrl
 * @param {string} params.cancelUrl
 * @param {string} [params.currency]
 * @returns {Promise<Stripe.Checkout.Session>}
 */
export async function createCheckoutSession({
  pack,
  userId,
  userEmail,
  successUrl,
  cancelUrl,
  currency = process.env.STRIPE_CURRENCY || 'usd',
}) {
  const metadata = {
    product: 'cinexvideo',
    user_id: String(userId),
    pack_code: pack.code,
    credits: String(pack.credits),
  };

  return getStripe().checkout.sessions.create({
    mode: 'payment',
    ...(userEmail ? { customer_email: userEmail } : {}),
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency,
          unit_amount: pack.price_cents,
          product_data: {
            name: pack.name || `${pack.credits} credits`,
            ...(pack.blurb ? { description: pack.blurb } : {}),
          },
        },
      },
    ],
    success_url: successUrl,
    cancel_url: cancelUrl,
    client_reference_id: String(userId),
    metadata,
    payment_intent_data: { metadata },
  });
}

/* ------------------------------------------------------------------ */
/* Payouts                                                             */
/* ------------------------------------------------------------------ */

/**
 * Transfer funds to a connected Express account.
 *
 * @param {Object} params
 * @param {string} params.accountId - Destination connected account.
 * @param {number} params.amountCents
 * @param {string} [params.payoutId] - partner_payouts.id, stored as metadata.
 * @param {string} [params.description]
 * @param {string} [params.currency]
 * @returns {Promise<Stripe.Transfer>}
 */
export async function createTransfer({
  accountId,
  amountCents,
  payoutId,
  description,
  currency = process.env.STRIPE_CURRENCY || 'usd',
}) {
  const metadata = { product: 'cinexvideo' };
  if (payoutId) metadata.cinexvideo_payout_id = String(payoutId);

  return getStripe().transfers.create(
    {
      amount: amountCents,
      currency,
      destination: accountId,
      ...(description ? { description } : {}),
      metadata,
    },
    // Idempotent per payout so a retry can never double-pay a partner.
    payoutId ? { idempotencyKey: `cinexvideo-payout-${payoutId}` } : undefined
  );
}

/** Legacy alias for {@link createTransfer}. */
export async function createPayout({ destination, amountCents, partnerId }) {
  return createTransfer({
    accountId: destination,
    amountCents,
    payoutId: partnerId,
  });
}

/* ------------------------------------------------------------------ */
/* Webhooks                                                            */
/* ------------------------------------------------------------------ */

/**
 * Verify and parse a Stripe webhook payload.
 *
 * @param {string} rawBody
 * @param {string} signature
 * @param {string} [secret]
 * @returns {Stripe.Event}
 */
export function constructWebhookEvent(rawBody, signature, secret) {
  const webhookSecret =
    secret ||
    process.env.CINEXVIDEO_STRIPE_WEBHOOK_SECRET ||
    process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    throw new Error('Stripe webhook secret is not configured.');
  }
  return getStripe().webhooks.constructEvent(rawBody, signature, webhookSecret);
}
