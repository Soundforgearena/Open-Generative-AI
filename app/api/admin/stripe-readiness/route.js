import { guard, safeError } from '../../../../lib/cinexvideo-server';
import { getStripe, stripeEnabled } from '../../../../lib/stripe-connect';

export const dynamic = 'force-dynamic';

const REQUIRED_ENV_VARS = [
  'STRIPE_SECRET_KEY',
  'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'APP_URL',
];

function keyMode(key) {
  if (!key) return null;
  if (key.startsWith('sk_live_') || key.startsWith('pk_live_')) return 'live';
  if (key.startsWith('sk_test_') || key.startsWith('pk_test_')) return 'test';
  return 'unknown';
}

/**
 * Read-only Stripe configuration and account status check.
 *
 * Never creates a customer, product, price, payment, checkout session, or
 * refund. The only Stripe API call made here is a single account retrieval,
 * which is a read operation.
 */
export async function GET(request) {
  const { error } = await guard(request, { requireAdminRole: true });
  if (error) return error;

  const checkedAt = new Date().toISOString();
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim() || '';
  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim() || '';
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim() || '';
  const appUrl = process.env.APP_URL?.trim() || '';
  const liveModeAllowedFlag = process.env.STRIPE_LIVE_MODE?.trim().toLowerCase();

  const missingVars = REQUIRED_ENV_VARS.filter((name) => !process.env[name]?.trim());

  const secretMode = keyMode(secretKey);
  const publishableMode = keyMode(publishableKey);
  const keyModesMatch = Boolean(secretMode && publishableMode && secretMode === publishableMode);
  const liveModeAllowed = liveModeAllowedFlag === 'true';

  const environment = {
    secretKeyConfigured: Boolean(secretKey),
    publishableKeyConfigured: Boolean(publishableKey),
    webhookSecretConfigured: Boolean(webhookSecret),
    appUrlConfigured: Boolean(appUrl),
    keyModesMatch,
    liveModeAllowed,
  };

  const stripeApi = {
    status: 'UNAVAILABLE',
    accountId: null,
    accountName: null,
    country: null,
    defaultCurrency: null,
    chargesEnabled: null,
    payoutsEnabled: null,
    detailsSubmitted: null,
    livemode: null,
    error: null,
  };

  if (!stripeEnabled()) {
    stripeApi.status = 'MISSING';
    stripeApi.error = 'STRIPE_SECRET_KEY is not configured.';
  } else {
    try {
      const account = await getStripe().accounts.retrieve();
      stripeApi.status = 'VERIFIED';
      stripeApi.accountId = account.id || null;
      stripeApi.accountName = account.business_profile?.name || account.settings?.dashboard?.display_name || null;
      stripeApi.country = account.country || null;
      stripeApi.defaultCurrency = account.default_currency || null;
      stripeApi.chargesEnabled = Boolean(account.charges_enabled);
      stripeApi.payoutsEnabled = Boolean(account.payouts_enabled);
      stripeApi.detailsSubmitted = Boolean(account.details_submitted);
      stripeApi.livemode = Boolean(account.livemode);

      if (account.livemode && !liveModeAllowed) {
        stripeApi.status = 'BLOCKED';
        stripeApi.error = 'Live Stripe account detected but STRIPE_LIVE_MODE is not enabled.';
      }
    } catch (err) {
      // Never surface the raw Stripe error message: it can echo back request
      // details. Only the safe classification below is returned.
      const isAuthError = err?.type === 'StripeAuthenticationError' || err?.statusCode === 401;
      stripeApi.status = isAuthError ? 'MISMATCH' : 'UNAVAILABLE';
      stripeApi.error = isAuthError
        ? 'Stripe rejected the configured secret key.'
        : 'Stripe account status could not be retrieved.';
      console.error('stripe readiness check failed', err?.type || err?.message || 'unknown error');
    }
  }

  const expectedUrl = appUrl ? `${appUrl.replace(/\/$/, '')}/api/billing/webhook` : null;
  const webhook = {
    expectedUrl,
    signingSecretConfigured: environment.webhookSecretConfigured,
    deliveryVerified: false,
    note: 'Webhook delivery cannot be confirmed here. Verify recent successful deliveries in the Stripe Dashboard or with the Stripe CLI.',
  };

  const warnings = [];
  const nextSteps = [];

  missingVars.forEach((name) => {
    warnings.push(`${name} is not configured.`);
    nextSteps.push(`Set ${name} in the deployment environment.`);
  });
  if (secretMode && publishableMode && !keyModesMatch) {
    warnings.push('STRIPE_SECRET_KEY and NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY are in different modes.');
    nextSteps.push('Use matching test or live keys for both the secret and publishable key.');
  }
  if (stripeApi.status === 'BLOCKED') {
    warnings.push(stripeApi.error);
    nextSteps.push('Set STRIPE_LIVE_MODE=true only when this deployment is ready to accept real payments.');
  }
  if (stripeApi.status === 'MISMATCH') {
    warnings.push(stripeApi.error);
    nextSteps.push('Confirm STRIPE_SECRET_KEY is correct and has not been revoked.');
  }
  if (stripeApi.status === 'VERIFIED' && !stripeApi.chargesEnabled) {
    warnings.push('Stripe account cannot accept charges yet.');
    nextSteps.push('Complete Stripe account activation requirements in the Stripe Dashboard.');
  }
  if (stripeApi.status === 'VERIFIED' && !stripeApi.detailsSubmitted) {
    warnings.push('Stripe account onboarding is incomplete.');
    nextSteps.push('Finish submitting required business details in the Stripe Dashboard.');
  }
  if (!webhook.signingSecretConfigured) {
    nextSteps.push('Set STRIPE_WEBHOOK_SECRET so incoming webhook signatures can be verified.');
  }
  nextSteps.push('Verify webhook delivery in the Stripe Dashboard or with the Stripe CLI before enabling live payments.');

  const safeToEnablePayments =
    environment.secretKeyConfigured &&
    environment.publishableKeyConfigured &&
    environment.webhookSecretConfigured &&
    environment.appUrlConfigured &&
    environment.keyModesMatch &&
    stripeApi.status === 'VERIFIED' &&
    stripeApi.chargesEnabled === true &&
    stripeApi.detailsSubmitted === true;

  return Response.json({
    checkedAt,
    safeToEnablePayments,
    environment,
    stripeApi,
    webhook,
    warnings,
    nextSteps,
  });
}
