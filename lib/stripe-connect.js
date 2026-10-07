import Stripe from 'stripe';
import { stripeSecretKey, stripeWebhookSecret } from './billing/payment-mode.js';

const STRIPE_API_VERSION = '2024-06-20';

const cachedClients = new Map();

/**
 * True when a Stripe secret key is present in the environment.
 *
 * Every Stripe-backed route calls this first so the app builds and boots
 * cleanly on deployments where billing has not been configured yet.
 */
export function stripeEnabled(mode = 'live') {
  return Boolean(stripeSecretKey(mode));
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
export function getStripe(mode = 'live') {
  const key = stripeSecretKey(mode);
  if (!key) {
    throw new Error(`Stripe is not configured: ${mode === 'test' ? 'STRIPE_TEST_SECRET_KEY' : 'STRIPE_SECRET_KEY'} is missing.`);
  }
  if (!cachedClients.has(key)) {
    cachedClients.set(key, new Stripe(key, { apiVersion: STRIPE_API_VERSION }));
  }
  return cachedClients.get(key);
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
 * Global payouts.
 *
 * CineXVideo's Stripe platform is in Canada (override with
 * STRIPE_PLATFORM_COUNTRY). Stripe lets a platform in the US, Canada, UK,
 * EEA or Switzerland pay Express accounts anywhere in that same group, with
 * Stripe converting to the partner's local currency. Partners in other
 * countries cannot self-onboard yet: their earnings keep accruing and are
 * never lost, and the super admin can contact Stripe about Global Payouts.
 */
export const EEA_COUNTRIES = Object.freeze([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IS', 'IE',
  'IT', 'LV', 'LI', 'LT', 'LU', 'MT', 'NL', 'NO', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
]);
export const CROSS_BORDER_REGION = Object.freeze(['US', 'CA', 'GB', 'CH', ...EEA_COUNTRIES]);

export const PAYOUT_COUNTRY_NAMES = Object.freeze({
  US: 'United States', CA: 'Canada', GB: 'United Kingdom', CH: 'Switzerland', AT: 'Austria', BE: 'Belgium',
  BG: 'Bulgaria', HR: 'Croatia', CY: 'Cyprus', CZ: 'Czech Republic', DK: 'Denmark', EE: 'Estonia', FI: 'Finland',
  FR: 'France', DE: 'Germany', GR: 'Greece', HU: 'Hungary', IS: 'Iceland', IE: 'Ireland', IT: 'Italy', LV: 'Latvia',
  LI: 'Liechtenstein', LT: 'Lithuania', LU: 'Luxembourg', MT: 'Malta', NL: 'Netherlands', NO: 'Norway', PL: 'Poland',
  PT: 'Portugal', RO: 'Romania', SK: 'Slovakia', SI: 'Slovenia', ES: 'Spain', SE: 'Sweden',
});

export function platformCountry(env = process.env) {
  return String(env.STRIPE_PLATFORM_COUNTRY || 'CA').toUpperCase();
}

/** Countries a partner can pick for self-serve Stripe Express payouts. */
export function payoutCountries(env = process.env) {
  const home = platformCountry(env);
  const codes = CROSS_BORDER_REGION.includes(home) ? CROSS_BORDER_REGION : [home];
  return codes
    .map((code) => ({ code, name: PAYOUT_COUNTRY_NAMES[code] || code }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function canOnboardCountry(country, env = process.env) {
  const code = String(country || '').toUpperCase();
  return payoutCountries(env).some((c) => c.code === code);
}

/**
 * Create a Stripe Connect Express account for a revenue partner. Partners only
 * receive transfers from the platform, so only the transfers capability is
 * requested, which keeps onboarding short.
 *
 * @param {Object} params
 * @param {string} params.email
 * @param {string} params.country - Two-letter country where the partner banks.
 * @param {string} [params.businessUrl]
 * @param {string} [params.partnerId] - revenue_partners.id, stored as metadata.
 * @param {string} [params.displayName]
 * @returns {Promise<Stripe.Account>}
 */
export async function createExpressAccount({ email, country, businessUrl, partnerId, displayName } = {}) {
  const code = String(country || '').toUpperCase();
  if (!canOnboardCountry(code)) {
    throw new Error('Stripe Express payouts are not available for that country yet.');
  }
  const metadata = {};
  if (partnerId) metadata.cinexvideo_partner_id = partnerId;
  if (email) metadata.partner_email = email;
  if (displayName) metadata.partner_display_name = displayName;

  return getStripe().accounts.create({
    type: 'express',
    email,
    country: code,
    capabilities: { transfers: { requested: true } },
    ...(businessUrl ? { business_profile: { url: businessUrl, product_description: 'Revenue partner payouts from CineXVideo' } } : {}),
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
  mode = 'live',
}) {
  const metadata = {
    product: 'cinexvideo',
    user_id: String(userId),
    pack_code: pack.code,
    credits: String(pack.credits),
  };

  return getStripe(mode).checkout.sessions.create({
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
  const webhookSecret = secret || stripeWebhookSecret('live');
  if (!webhookSecret) {
    throw new Error('Stripe webhook secret is not configured.');
  }
  return Stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
}

/**
 * Verify a webhook against the live signing secret, then the sandbox one.
 * Signature checks are local (no API call), so either mode works whichever
 * one is currently switched on.
 */
export function verifyWebhookEvent(rawBody, signature) {
  let lastError = new Error('Stripe webhook secret is not configured.');
  for (const mode of ['live', 'test']) {
    const secret = stripeWebhookSecret(mode);
    if (!secret) continue;
    try {
      return { event: Stripe.webhooks.constructEvent(rawBody, signature, secret), mode };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

/* ------------------------------------------------------------------ */
/* Monthly plans                                                       */
/* ------------------------------------------------------------------ */

/**
 * Hosted Checkout for a monthly plan. The price comes from the database plan
 * row, never the request. Credits are granted on each paid invoice
 * (invoice.paid webhook), not on checkout, so nothing is granted twice.
 */
export async function createSubscriptionCheckoutSession({
  plan,
  userId,
  userEmail,
  successUrl,
  cancelUrl,
  currency = process.env.STRIPE_CURRENCY || 'usd',
  mode = 'live',
}) {
  const metadata = {
    product: 'cinexvideo',
    kind: 'subscription',
    user_id: String(userId),
    plan_code: plan.code,
    credits: String(plan.included_credits),
  };
  return getStripe(mode).checkout.sessions.create({
    mode: 'subscription',
    ...(userEmail ? { customer_email: userEmail } : {}),
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency,
          unit_amount: plan.monthly_price_cents,
          recurring: { interval: 'month' },
          product_data: {
            name: `CineXVideo ${plan.name} plan`,
            description: plan.blurb || `${plan.included_credits} credits every month`,
          },
        },
      },
    ],
    success_url: successUrl,
    cancel_url: cancelUrl,
    client_reference_id: String(userId),
    metadata,
    subscription_data: { metadata },
  });
}

/** Cancel at the end of the paid month (cancel = true) or undo that (false). */
export async function setSubscriptionCancelAtPeriodEnd(subscriptionId, cancel, mode = 'live') {
  return getStripe(mode).subscriptions.update(subscriptionId, { cancel_at_period_end: Boolean(cancel) });
}

export async function getSubscription(subscriptionId, mode = 'live') {
  return getStripe(mode).subscriptions.retrieve(subscriptionId);
}

/**
 * True when a failed Stripe call may still have gone through (network drop,
 * Stripe outage). Those payouts are left pending for a manual check instead
 * of releasing the earnings, so a partner can never be paid twice.
 */
export function transferOutcomeUnknown(error) {
  const type = error?.type || error?.rawType || '';
  return ['StripeConnectionError', 'StripeAPIError', 'api_error'].includes(type) || !type;
}
