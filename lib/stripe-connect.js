/**
 * Minimal Stripe Connect Express client.
 *
 * Deliberately no SDK dependency — the Stripe REST API is form-encoded and the
 * handful of calls we need are small, so this avoids adding a package that
 * would need to survive the Docker build.
 *
 * Payouts are optional. If STRIPE_SECRET_KEY is unset the platform runs in
 * manual payout mode: earnings are still tracked and payouts are still
 * recorded, they are just settled by hand outside the app.
 */

const STRIPE_API = 'https://api.stripe.com/v1';

export function stripeEnabled() {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

/** Flattens nested objects into Stripe's bracket form-encoding. */
function encode(params, prefix = '', form = new URLSearchParams()) {
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const field = prefix ? `${prefix}[${key}]` : key;
    if (typeof value === 'object' && !Array.isArray(value)) encode(value, field, form);
    else form.append(field, String(value));
  }
  return form;
}

async function stripeRequest(path, { method = 'POST', params, idempotencyKey } = {}) {
  if (!stripeEnabled()) throw new Error('Stripe payouts are not configured.');

  const headers = {
    Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  // Guarantees a retried transfer never sends money twice.
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  const response = await fetch(`${STRIPE_API}${path}`, {
    method,
    headers,
    body: params ? encode(params).toString() : undefined,
    cache: 'no-store',
  });

  const data = await response.json();
  if (!response.ok) {
    const message = data?.error?.message || 'Stripe request failed';
    const error = new Error(message);
    error.stripeCode = data?.error?.code;
    throw error;
  }
  return data;
}

/**
 * Creates an Express connected account.
 *
 * Note: `type: 'express'` is deprecated. The controller form below is the
 * current way to say "Express dashboard, platform pays fees, platform takes
 * loss liability, Stripe collects requirements".
 */
export async function createExpressAccount({ email, country = 'US', businessUrl }) {
  return stripeRequest('/accounts', {
    params: {
      email,
      country,
      controller: {
        fees: { payer: 'application' },
        losses: { payments: 'application' },
        stripe_dashboard: { type: 'express' },
      },
      capabilities: { transfers: { requested: true } },
      business_profile: businessUrl ? { url: businessUrl } : undefined,
    },
  });
}

/** One-time onboarding URL. These expire quickly, so mint on demand. */
export async function createOnboardingLink({ accountId, refreshUrl, returnUrl }) {
  const link = await stripeRequest('/account_links', {
    params: {
      account: accountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: 'account_onboarding',
    },
  });
  return link.url;
}

/** Lets a partner open their Express dashboard to see payouts and change bank details. */
export async function createDashboardLink(accountId) {
  const link = await stripeRequest(`/accounts/${accountId}/login_links`);
  return link.url;
}

export async function getAccount(accountId) {
  return stripeRequest(`/accounts/${accountId}`, { method: 'GET' });
}

/** Reduces a Stripe account to the few fields the cockpit needs. */
export function summariseAccount(account) {
  const due = account?.requirements?.currently_due || [];
  return {
    payouts_enabled: Boolean(account?.payouts_enabled),
    details_submitted: Boolean(account?.details_submitted),
    requirements_due: due,
    disabled_reason: account?.requirements?.disabled_reason || null,
    onboarding_status: account?.payouts_enabled
      ? 'complete'
      : account?.details_submitted
        ? 'under_review'
        : due.length
          ? 'action_required'
          : 'not_started',
  };
}

/**
 * Moves money from the platform balance to a connected account.
 * `payoutId` is used as the idempotency key so a retry cannot double-send.
 */
export async function createTransfer({ accountId, amountCents, currency = 'usd', payoutId, description }) {
  return stripeRequest('/transfers', {
    params: {
      amount: amountCents,
      currency,
      destination: accountId,
      description,
      metadata: { payout_id: payoutId },
    },
    idempotencyKey: `cinex_payout_${payoutId}`,
  });
}

/* --------------------------------------------------------------- checkout */

// This Stripe account is shared with several other products. Every object
// CinexVideo creates carries this tag so its payments can be identified in the
// dashboard, reconciled in reports, and — critically — told apart from other
// products' events by the webhook.
export const PRODUCT_TAG = 'cinexvideo';

/** Hosted Checkout session for a one-time credit pack purchase. */
export async function createCheckoutSession({
  pack,
  userId,
  userEmail,
  successUrl,
  cancelUrl,
  idempotencyKey,
}) {
  return stripeRequest('/checkout/sessions', {
    params: {
      mode: 'payment',
      customer_email: userEmail,
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: userId,
      // Read back in the webhook. Never trust the browser for these.
      metadata: {
        product: PRODUCT_TAG,
        site: 'cinexvideo.app',
        user_id: userId,
        pack_code: pack.code,
        credits: pack.credits,
      },
      payment_intent_data: {
        description: `CinexVideo — ${pack.name} (${pack.credits} credits)`,
        // This Stripe account is shared across several products, so its
        // account-level statement descriptor is not "CinexVideo". Without a
        // suffix the customer sees an unrelated business name on their card
        // statement, which is a common cause of "I don't recognise this
        // charge" disputes.
        statement_descriptor_suffix: 'CINEXVIDEO',
        // Duplicated onto the PaymentIntent because charge- and payout-level
        // reporting in Stripe does not inherit Checkout Session metadata.
        metadata: {
          product: PRODUCT_TAG,
          site: 'cinexvideo.app',
          user_id: userId,
          pack_code: pack.code,
          credits: pack.credits,
        },
      },
      'line_items[0][quantity]': 1,
      // CinexVideo prices are USD. Hardcoded rather than env-driven so a
      // misconfigured variable can never silently change what customers are
      // charged.
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][unit_amount]': pack.price_cents,
      'line_items[0][price_data][product_data][name]': `${pack.name} — ${pack.credits} credits`,
      'line_items[0][price_data][product_data][description]':
        pack.blurb || 'CinexVideo generation credits',
    },
    idempotencyKey,
  });
}

/**
 * Returns the settled amount and the real Stripe fee for a completed session.
 *
 * Both figures are read from the balance transaction so they are always in the
 * same (settlement) currency. Taking `session.amount_total` instead would mix
 * currencies whenever the charge currency differs from the account's payout
 * currency — this account settles in CAD — and every downstream revenue split
 * would be computed from an amount and a fee denominated differently.
 */
export async function getSessionSettlement(session) {
  const fallback = {
    amountCents: session.amount_total,
    feeCents: Math.round(session.amount_total * 0.029) + 30,
    currency: session.currency,
    estimated: true,
  };
  try {
    const paymentIntentId =
      typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
    if (!paymentIntentId) return fallback;

    const intent = await stripeRequest(
      `/payment_intents/${paymentIntentId}?expand[]=latest_charge.balance_transaction`,
      { method: 'GET' }
    );
    const txn = intent?.latest_charge?.balance_transaction;
    if (!Number.isFinite(txn?.amount) || !Number.isFinite(txn?.fee)) return fallback;

    // txn.amount is gross in settlement currency; txn.fee includes processing
    // and any currency-conversion fee.
    return { amountCents: txn.amount, feeCents: txn.fee, currency: txn.currency, estimated: false };
  } catch {
    return fallback;
  }
}

/**
 * Verifies a Stripe webhook signature.
 *
 * Implemented directly rather than via the SDK: HMAC-SHA256 over
 * `${timestamp}.${rawBody}`, compared against the v1 signatures in the header,
 * in constant time, with a replay window.
 */
export async function verifyWebhook(rawBody, signatureHeader, secret, toleranceSeconds = 300) {
  if (!signatureHeader || !secret) return false;

  const parts = Object.fromEntries(
    signatureHeader.split(',').map((part) => {
      const [key, ...rest] = part.split('=');
      return [key.trim(), rest.join('=')];
    })
  );
  const timestamp = parts.t;
  if (!timestamp) return false;

  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > toleranceSeconds) return false;

  const provided = signatureHeader
    .split(',')
    .filter((part) => part.trim().startsWith('v1='))
    .map((part) => part.trim().slice(3));
  if (!provided.length) return false;

  const { createHmac, timingSafeEqual } = await import('node:crypto');
  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  const expectedBuffer = Buffer.from(expected, 'utf8');

  return provided.some((candidate) => {
    const candidateBuffer = Buffer.from(candidate, 'utf8');
    return (
      candidateBuffer.length === expectedBuffer.length &&
      timingSafeEqual(candidateBuffer, expectedBuffer)
    );
  });
}
