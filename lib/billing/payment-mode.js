// Customer payments can run against Stripe's sandbox (test cards, no real
// money) or live Stripe. A super admin flips the switch in the admin area;
// no redeploy is needed.
//
// Sandbox safety:
// - Only admins can check out while the sandbox is on, so nobody else can
//   get credits with a test card.
// - Sandbox purchases are recorded as provider 'stripe_test' with their full
//   amount booked as fees, so they carry zero revenue value: they never count
//   as income and never create partner earnings.

export const PAYMENT_MODES = ['test', 'live'];
export const PAYMENT_MODE_SETTING = 'payment_mode';

export function stripeSecretKey(mode) {
  return mode === 'test' ? process.env.STRIPE_TEST_SECRET_KEY || '' : process.env.STRIPE_SECRET_KEY || '';
}

export function stripeWebhookSecret(mode) {
  return mode === 'test'
    ? process.env.STRIPE_TEST_WEBHOOK_SECRET || ''
    : process.env.CINEXVIDEO_STRIPE_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET || '';
}

/** Ready = secret key of the right kind plus a webhook signing secret. */
export function modeReadiness(mode) {
  const key = stripeSecretKey(mode);
  const prefix = mode === 'test' ? 'sk_test_' : 'sk_live_';
  const keyOk = key.startsWith(prefix) || key.startsWith(mode === 'test' ? 'rk_test_' : 'rk_live_');
  return {
    mode,
    secret_key: Boolean(key),
    secret_key_matches_mode: keyOk,
    webhook_secret: Boolean(stripeWebhookSecret(mode)),
    ready: keyOk && Boolean(stripeWebhookSecret(mode)),
  };
}

/** Resolve the stored setting. Unset means live (the original behaviour). */
export function resolvePaymentMode(setting) {
  const mode = setting?.mode;
  return PAYMENT_MODES.includes(mode) ? mode : 'live';
}

/** Who may start a checkout in the current mode. */
export function canCheckout(mode, { admin = false } = {}) {
  if (mode === 'test') return Boolean(admin);
  return true;
}

/** Values passed to fulfil_credit_purchase for a paid Stripe object. */
export function purchaseAccounting({ livemode, amountCents }) {
  if (livemode === false) {
    return { provider: 'stripe_test', feeCents: amountCents };
  }
  return { provider: 'stripe', feeCents: 0 };
}
