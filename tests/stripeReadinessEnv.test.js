const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveStripeEnv } = require('../lib/stripe-readiness-env.js');

const FULL = {
  STRIPE_SECRET_KEY: 'sk_test_123',
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_test_123',
  STRIPE_WEBHOOK_SECRET: 'whsec_123',
  APP_URL: 'https://cinexvideo.app',
};

test('a fully configured deployment reports nothing missing', () => {
  const result = resolveStripeEnv(FULL);
  assert.deepEqual(result.missing, []);
  assert.equal(result.webhookSecretSource, 'STRIPE_WEBHOOK_SECRET');
  assert.equal(result.appUrlSource, 'APP_URL');
});

test('the CINEXVIDEO webhook alias counts as configured', () => {
  // The webhook route and constructWebhookEvent both accept this name, so
  // reporting it as missing would contradict what the app actually does.
  const result = resolveStripeEnv({
    ...FULL,
    STRIPE_WEBHOOK_SECRET: undefined,
    CINEXVIDEO_STRIPE_WEBHOOK_SECRET: 'whsec_alias',
  });
  assert.equal(result.webhookSecret, 'whsec_alias');
  assert.equal(result.webhookSecretSource, 'CINEXVIDEO_STRIPE_WEBHOOK_SECRET');
  assert.deepEqual(result.missing, []);
});

test('NEXT_PUBLIC_SITE_URL satisfies the app URL requirement', () => {
  // Checkout and Connect build their return URLs from NEXT_PUBLIC_SITE_URL.
  const result = resolveStripeEnv({
    ...FULL,
    APP_URL: undefined,
    NEXT_PUBLIC_SITE_URL: 'https://cinexvideo.app',
  });
  assert.equal(result.appUrl, 'https://cinexvideo.app');
  assert.equal(result.appUrlSource, 'NEXT_PUBLIC_SITE_URL');
  assert.deepEqual(result.missing, []);
});

test('APP_URL is preferred over the public URLs when several are set', () => {
  const result = resolveStripeEnv({
    ...FULL,
    NEXT_PUBLIC_SITE_URL: 'https://staging.cinexvideo.app',
  });
  assert.equal(result.appUrl, 'https://cinexvideo.app');
  assert.equal(result.appUrlSource, 'APP_URL');
});

test('NEXT_PUBLIC_APP_URL is the last app URL fallback', () => {
  const result = resolveStripeEnv({
    ...FULL,
    APP_URL: undefined,
    NEXT_PUBLIC_APP_URL: 'https://cinexvideo.app',
  });
  assert.equal(result.appUrlSource, 'NEXT_PUBLIC_APP_URL');
});

test('whitespace-only values are treated as missing', () => {
  const result = resolveStripeEnv({ ...FULL, STRIPE_SECRET_KEY: '   ' });
  assert.equal(result.secretKey, '');
  assert.ok(result.missing.includes('STRIPE_SECRET_KEY'));
});

test('an empty environment reports every requirement once', () => {
  const result = resolveStripeEnv({});
  assert.equal(result.missing.length, 4);
  assert.ok(result.missing.includes('STRIPE_SECRET_KEY'));
  assert.ok(result.missing.includes('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY'));
  assert.ok(result.missing.some((name) => name.includes('STRIPE_WEBHOOK_SECRET')));
  assert.ok(result.missing.some((name) => name.includes('APP_URL')));
});

test('resolveStripeEnv tolerates being called with no argument', () => {
  assert.equal(resolveStripeEnv().missing.length, 4);
});

test('the missing list names both accepted webhook variables', () => {
  const result = resolveStripeEnv({});
  assert.ok(
    result.missing.includes('STRIPE_WEBHOOK_SECRET or CINEXVIDEO_STRIPE_WEBHOOK_SECRET'),
    'operators need to know either name is accepted'
  );
});
