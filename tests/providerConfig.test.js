const test = require('node:test');
const assert = require('node:assert/strict');

const { describeProviderConfiguration, coreProvidersReady } = require('../lib/admin/provider-config.js');

const FULL = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://p.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x',
  SUPABASE_SERVICE_ROLE_KEY: 'SENTINEL_SERVICE_ROLE',
  MUAPI_API_KEY: 'SENTINEL_MUAPI',
  OPENAI_API_KEY: 'SENTINEL_OPENAI',
  STRIPE_SECRET_KEY: 'sk_test_SENTINEL',
  STRIPE_WEBHOOK_SECRET: 'whsec_SENTINEL',
  CRON_SECRET: 'SENTINEL_CRON',
};

function find(env, key) {
  return describeProviderConfiguration(env).find((p) => p.key === key);
}

test('a fully configured environment reports every provider configured', () => {
  assert.ok(describeProviderConfiguration(FULL).every((p) => p.configured));
  assert.equal(coreProvidersReady(FULL), true);
});

test('a missing MuAPI key is reported as a blocking gap', () => {
  const provider = find({ ...FULL, MUAPI_API_KEY: undefined }, 'muapi');
  assert.equal(provider.configured, false);
  assert.equal(provider.required, true);
  assert.deepEqual(provider.missing, ['MUAPI_API_KEY']);
  assert.equal(coreProvidersReady({ ...FULL, MUAPI_API_KEY: undefined }), false);
});

test('a missing OpenAI key is reported, which nothing surfaced before', () => {
  const provider = find({ ...FULL, OPENAI_API_KEY: '' }, 'openai');
  assert.equal(provider.configured, false);
  assert.deepEqual(provider.missing, ['OPENAI_API_KEY']);
});

test('Supabase needs all three of its variables', () => {
  const provider = find({ ...FULL, SUPABASE_SERVICE_ROLE_KEY: undefined }, 'supabase');
  assert.equal(provider.configured, false);
  assert.deepEqual(provider.missing, ['SUPABASE_SERVICE_ROLE_KEY']);
});

test('either webhook secret name satisfies the webhook provider', () => {
  const env = { ...FULL, STRIPE_WEBHOOK_SECRET: undefined, CINEXVIDEO_STRIPE_WEBHOOK_SECRET: 'whsec_2' };
  assert.equal(find(env, 'stripe_webhook').configured, true);
});

test('a missing webhook secret names both accepted variables', () => {
  const env = { ...FULL, STRIPE_WEBHOOK_SECRET: undefined };
  const provider = find(env, 'stripe_webhook');
  assert.equal(provider.configured, false);
  assert.deepEqual(provider.missing, ['STRIPE_WEBHOOK_SECRET or CINEXVIDEO_STRIPE_WEBHOOK_SECRET']);
});

test('Stripe is optional so it does not block core readiness', () => {
  const env = { ...FULL, STRIPE_SECRET_KEY: undefined };
  assert.equal(find(env, 'stripe').required, false);
  assert.equal(coreProvidersReady(env), true);
});

test('whitespace-only values do not count as configured', () => {
  assert.equal(find({ ...FULL, MUAPI_API_KEY: '   ' }, 'muapi').configured, false);
});

test('no secret value is ever included in the report', () => {
  const serialised = JSON.stringify(describeProviderConfiguration(FULL));
  for (const secret of ['SENTINEL_OPENAI', 'sk_test_SENTINEL', 'whsec_SENTINEL', 'SENTINEL_SERVICE_ROLE', 'SENTINEL_MUAPI', 'SENTINEL_CRON']) {
    assert.ok(!serialised.includes(secret), `report leaked ${secret}`);
  }
});

test('an empty environment reports every required provider as missing', () => {
  const report = describeProviderConfiguration({});
  assert.ok(report.every((p) => !p.configured));
  assert.equal(coreProvidersReady({}), false);
});
