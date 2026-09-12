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
  assert.equal(result.missing.length, 3);
  assert.ok(result.missing.includes('STRIPE_SECRET_KEY'));
  assert.ok(result.missing.some((name) => name.includes('STRIPE_WEBHOOK_SECRET')));
  assert.ok(result.missing.some((name) => name.includes('APP_URL')));
});

test('resolveStripeEnv tolerates being called with no argument', () => {
  assert.equal(resolveStripeEnv().missing.length, 3);
});

test('the missing list names both accepted webhook variables', () => {
  const result = resolveStripeEnv({});
  assert.ok(
    result.missing.includes('STRIPE_WEBHOOK_SECRET or CINEXVIDEO_STRIPE_WEBHOOK_SECRET'),
    'operators need to know either name is accepted'
  );
});

const { classifyPublishableKey } = require('../lib/stripe-readiness-env.js');

test('a key present in the build is usable by the browser', () => {
  const result = classifyPublishableKey('pk_test_1', 'pk_test_1');
  assert.equal(result.inBrowserBundle, true);
  assert.equal(result.state, 'ok');
  assert.equal(result.effectiveKey, 'pk_test_1');
});

test('a key set only at runtime is not in the browser bundle', () => {
  // The exact situation when the variable is added to the host after the last
  // build: server code can read it, the browser cannot.
  const result = classifyPublishableKey('pk_test_1', '');
  assert.equal(result.inBrowserBundle, false);
  assert.equal(result.state, 'runtime-only');
});

test('a key changed since the build is reported as stale', () => {
  const result = classifyPublishableKey('pk_live_new', 'pk_test_old');
  assert.equal(result.state, 'stale');
  // The browser is still serving the older compiled key.
  assert.equal(result.effectiveKey, 'pk_test_old');
});

test('no key anywhere is simply missing', () => {
  const result = classifyPublishableKey('', '');
  assert.equal(result.state, 'missing');
  assert.equal(result.inBrowserBundle, false);
});

test('classifyPublishableKey ignores surrounding whitespace', () => {
  assert.equal(classifyPublishableKey('  pk_test_1  ', '  pk_test_1  ').state, 'ok');
  assert.equal(classifyPublishableKey('pk_test_1', '   ').state, 'runtime-only');
});
