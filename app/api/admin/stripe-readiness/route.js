import { guard, safeError } from '../../../../lib/cinexvideo-server';
import { getStripe, stripeEnabled } from '../../../../lib/stripe-connect';
import { resolveStripeEnv, classifyPublishableKey } from '../../../../lib/stripe-readiness-env';

export const dynamic = 'force-dynamic';

// Deliberately written as a literal process.env member expression at module
// scope so Next substitutes it during the build. This captures what the
// browser bundle actually shipped with, which is the only value client-side
// Stripe can use. resolveStripeEnv() reads the live environment dynamically,
// so comparing the two detects a key that was added to the host after the
// last build and is therefore missing from the browser.
const BUILD_TIME_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || '';

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
  // Resolved through the shared helper so this screen reports the same
  // variable names the request-time code actually reads. Checking only
  // STRIPE_WEBHOOK_SECRET and APP_URL used to show "Missing" for deployments
  // that were correctly configured with the alias or with NEXT_PUBLIC_SITE_URL.
  const {
    secretKey,
    publishableKey,
    webhookSecret,
    webhookSecretSource,
    appUrl,
    appUrlSource,
    missing: missingVars,
  } = resolveStripeEnv(process.env);
  const liveModeAllowedFlag = process.env.STRIPE_LIVE_MODE?.trim().toLowerCase();

  const publishable = classifyPublishableKey(publishableKey, BUILD_TIME_PUBLISHABLE_KEY);

  const secretMode = keyMode(secretKey);
  const publishableMode = keyMode(publishable.effectiveKey);
  const keyModesMatch = Boolean(secretMode && publishableMode && secretMode === publishableMode);
  const liveModeAllowed = liveModeAllowedFlag === 'true';

  const environment = {
    secretKeyConfigured: Boolean(secretKey),
    publishableKeyConfigured: Boolean(publishable.effectiveKey),
    publishableKeyInBrowserBundle: publishable.inBrowserBundle,
    publishableKeyState: publishable.state,
    webhookSecretConfigured: Boolean(webhookSecret),
    webhookSecretSource,
    appUrlConfigured: Boolean(appUrl),
    appUrlSource,
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
  if (publishable.effectiveKey && publishable.state === 'runtime-only') {
    warnings.push(
      'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY was added after this build, so browser-only Stripe features would still need a redeploy.'
    );
  }
  if (publishable.effectiveKey && publishable.state === 'stale') {
    warnings.push(
      'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY changed since this build, so browser-only Stripe features would still use the older key.'
    );
  }
  if (secretMode && publishableMode && !keyModesMatch) {
    warnings.push('STRIPE_SECRET_KEY and NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY are in different modes.');
    nextSteps.push('Use matching test or live keys for both keys if browser-side Stripe features are enabled.');
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
    environment.webhookSecretConfigured &&
    environment.appUrlConfigured &&
    (!publishable.effectiveKey || environment.keyModesMatch) &&
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
