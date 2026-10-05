import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { canCheckout, modeReadiness, purchaseAccounting, resolvePaymentMode, stripeSecretKey, stripeWebhookSecret } from '../lib/billing/payment-mode.js';

const src = (p) => readFile(new URL(`../${p}`, import.meta.url), 'utf8');

test('payment mode defaults to live and only accepts test/live', () => {
  assert.equal(resolvePaymentMode(null), 'live');
  assert.equal(resolvePaymentMode({ mode: 'test' }), 'test');
  assert.equal(resolvePaymentMode({ mode: 'free' }), 'live');
});

test('sandbox checkout is admins only; live is everyone', () => {
  assert.equal(canCheckout('test', { admin: false }), false);
  assert.equal(canCheckout('test', { admin: true }), true);
  assert.equal(canCheckout('live', { admin: false }), true);
});

test('sandbox purchases carry zero revenue value', () => {
  assert.deepEqual(purchaseAccounting({ livemode: false, amountCents: 1900 }), { provider: 'stripe_test', feeCents: 1900 });
  assert.deepEqual(purchaseAccounting({ livemode: true, amountCents: 1900 }), { provider: 'stripe', feeCents: 0 });
});

test('each mode reads its own keys and rejects the wrong kind', () => {
  const saved = { ...process.env };
  process.env.STRIPE_TEST_SECRET_KEY = 'sk_test_x';
  process.env.STRIPE_TEST_WEBHOOK_SECRET = 'whsec_t';
  process.env.STRIPE_SECRET_KEY = 'sk_test_wrong';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_l';
  assert.equal(stripeSecretKey('test'), 'sk_test_x');
  assert.equal(stripeWebhookSecret('live'), process.env.CINEXVIDEO_STRIPE_WEBHOOK_SECRET || 'whsec_l');
  assert.equal(modeReadiness('test').ready, true);
  assert.equal(modeReadiness('live').ready, false, 'a test key in the live slot is not live-ready');
  Object.assign(process.env, saved);
  for (const k of ['STRIPE_TEST_SECRET_KEY', 'STRIPE_TEST_WEBHOOK_SECRET']) if (!(k in saved)) delete process.env[k];
});

test('routes enforce the mode; switching live needs a super admin and typed LIVE', async () => {
  const admin = await src('app/api/admin/payment-mode/route.js');
  assert.match(admin, /requireSuperAdmin: true/);
  assert.match(admin, /body\.confirm !== 'LIVE'/);
  assert.match(admin, /!readiness\.ready/);
  for (const p of ['app/api/billing/checkout/route.js', 'app/api/billing/subscription/route.js']) {
    const s = await src(p);
    assert.match(s, /canCheckout\(mode, \{ admin \}\)/, p);
    assert.match(s, /mode,\n\s+\}\);/, p);
  }
  const hook = await src('app/api/billing/webhook/route.js');
  assert.match(hook, /verifyWebhookEvent\(body, signature\)/);
  assert.equal((hook.match(/purchaseAccounting\(/g) || []).length, 2);
});
