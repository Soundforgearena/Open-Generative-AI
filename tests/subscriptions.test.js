import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { invoiceGrant, subscriptionMetadata, subscriptionRow } from '../lib/billing/subscriptions.js';
import { CUSTOMER_SUBSCRIPTION_PLANS } from '../lib/billing/credit-catalog.js';
import { NET_CENTS_PER_CREDIT } from '../lib/billing/director-pricing.js';

const meta = { product: 'cinexvideo', kind: 'subscription', user_id: 'u1', plan_code: 'studio', credits: '5150' };

test('paid plan invoices grant credits once per payment', () => {
  const grant = invoiceGrant({ object: 'invoice', id: 'in_1', payment_intent: 'pi_1', amount_paid: 4900, currency: 'usd', subscription_details: { metadata: meta } });
  assert.deepEqual(grant, { userId: 'u1', planCode: 'studio', credits: 5150, amountCents: 4900, currency: 'usd', paymentId: 'pi_1' });
  assert.equal(invoiceGrant({ object: 'invoice', id: 'in_2', amount_paid: 0, subscription_details: { metadata: meta } }), null);
  assert.equal(invoiceGrant({ object: 'invoice', id: 'in_3', amount_paid: 4900, subscription_details: { metadata: { product: 'other' } } }), null);
});

test('subscription metadata is found on subscriptions and newer invoice shapes', () => {
  assert.equal(subscriptionMetadata({ object: 'subscription', metadata: meta }).plan_code, 'studio');
  assert.equal(subscriptionMetadata({ object: 'invoice', parent: { subscription_details: { metadata: meta } } }).user_id, 'u1');
  const row = subscriptionRow({ id: 'sub_1', customer: 'cus_1', status: 'active', current_period_end: 1800000000, cancel_at_period_end: true, metadata: meta });
  assert.equal(row.user_id, 'u1');
  assert.equal(row.cancel_at_period_end, true);
  assert.match(row.current_period_end, /^2027-/);
});

test('monthly plans never earn less per credit than pricing assumes', () => {
  for (const plan of CUSTOMER_SUBSCRIPTION_PLANS) {
    const net = (plan.priceCents - Math.round(30 + plan.priceCents * 0.029)) / plan.creditsGranted;
    assert.ok(net >= NET_CENTS_PER_CREDIT - 1e-9, plan.id);
  }
});

test('subscription checkout never grants credits; invoices do', async () => {
  const hook = await readFile(new URL('../app/api/billing/webhook/route.js', import.meta.url), 'utf8');
  assert.match(hook, /session\.mode === 'subscription'/);
  assert.match(hook, /case 'invoice\.paid'/);
  const migration = await readFile(new URL('../supabase/migrations/20261005180000_monthly_subscriptions.sql', import.meta.url), 'utf8');
  for (const plan of CUSTOMER_SUBSCRIPTION_PLANS) assert.match(migration, new RegExp(`'${plan.id}',\\s+'${plan.name}',\\s+${plan.priceCents}, ${plan.creditsGranted}`));
});
