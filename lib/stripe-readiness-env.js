/**
 * Pure resolver for the Stripe environment variables the readiness screen
 * reports on.
 *
 * This exists because the readiness check and the code that actually runs at
 * request time were reading different variable names, so the screen could
 * report "Missing" for a value the running app was using successfully:
 *
 *   - The webhook route and constructWebhookEvent() accept
 *     CINEXVIDEO_STRIPE_WEBHOOK_SECRET as an alias for STRIPE_WEBHOOK_SECRET.
 *   - Checkout and Connect build their return URLs from NEXT_PUBLIC_SITE_URL
 *     (falling back to NEXT_PUBLIC_APP_URL and finally the request origin).
 *     Nothing outside the readiness check has ever read APP_URL.
 *
 * Resolving both here keeps the reported status honest about what the
 * deployment will actually do, and names the variable that supplied the value
 * so the admin screen can show it.
 */

const WEBHOOK_SECRET_VARS = ['STRIPE_WEBHOOK_SECRET', 'CINEXVIDEO_STRIPE_WEBHOOK_SECRET'];
const APP_URL_VARS = ['APP_URL', 'NEXT_PUBLIC_SITE_URL', 'NEXT_PUBLIC_APP_URL'];

function firstConfigured(env, names) {
  for (const name of names) {
    const value = typeof env[name] === 'string' ? env[name].trim() : '';
    if (value) return { value, source: name };
  }
  return { value: '', source: null };
}

function readTrimmed(env, name) {
  return typeof env[name] === 'string' ? env[name].trim() : '';
}

/**
 * @param {Record<string, string | undefined>} env
 */
export function resolveStripeEnv(env = {}) {
  const secretKey = readTrimmed(env, 'STRIPE_SECRET_KEY');
  const publishableKey = readTrimmed(env, 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY');
  const webhook = firstConfigured(env, WEBHOOK_SECRET_VARS);
  const appUrl = firstConfigured(env, APP_URL_VARS);

  const missing = [];
  if (!secretKey) missing.push('STRIPE_SECRET_KEY');
  if (!publishableKey) missing.push('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY');
  if (!webhook.value) missing.push(WEBHOOK_SECRET_VARS.join(' or '));
  if (!appUrl.value) missing.push(APP_URL_VARS.join(' or '));

  return {
    secretKey,
    publishableKey,
    webhookSecret: webhook.value,
    webhookSecretSource: webhook.source,
    appUrl: appUrl.value,
    appUrlSource: appUrl.source,
    missing,
  };
}

/**
 * Classify the publishable key across the build/runtime boundary.
 *
 * NEXT_PUBLIC_* values are substituted by Next during `npm run build`, so the
 * key the browser ships with is whatever was present when the image was built
 * — not whatever the container has in its environment now. A value added to
 * the hosting platform after the last build is visible to server code but is
 * absent from the browser bundle, and client-side Stripe still cannot
 * initialise. Reporting only the runtime value would call that "Configured"
 * and be wrong.
 *
 * @param {string} runtimeValue value read from the live process environment
 * @param {string} buildValue value inlined when the bundle was compiled
 */
export function classifyPublishableKey(runtimeValue, buildValue) {
  const runtime = (runtimeValue || '').trim();
  const build = (buildValue || '').trim();

  if (build) {
    return {
      inBrowserBundle: true,
      state: runtime && runtime !== build ? 'stale' : 'ok',
      effectiveKey: build,
    };
  }
  if (runtime) {
    // Set on the platform but never passed into the build.
    return { inBrowserBundle: false, state: 'runtime-only', effectiveKey: runtime };
  }
  return { inBrowserBundle: false, state: 'missing', effectiveKey: '' };
}

export { WEBHOOK_SECRET_VARS, APP_URL_VARS };
