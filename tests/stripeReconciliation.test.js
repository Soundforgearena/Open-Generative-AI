const test = require('node:test');
const assert = require('node:assert/strict');

const {
  extractStripeSettlement,
  looksLikeStripePaymentIntent,
  looksLikeStripeCheckoutSession,
  looksLikeStripeCharge,
} = require('../lib/billing/stripe-reconciliation.js');

test('stripe reconcile id guards recognise supported reference types', () => {
  assert.equal(looksLikeStripePaymentIntent('pi_123'), true);
  assert.equal(looksLikeStripeCheckoutSession('cs_test_123'), true);
  assert.equal(looksLikeStripeCharge('ch_123'), true);
  assert.equal(looksLikeStripePaymentIntent('cs_test_123'), false);
});

test('stripe reconciliation extracts fee settlement from an expanded payment intent', () => {
  const settlement = extractStripeSettlement({
    paymentIntent: {
      id: 'pi_123',
      currency: 'usd',
      amount_received: 2500,
      latest_charge: {
        id: 'ch_123',
        balance_transaction: {
          id: 'txn_123',
          fee: 102,
          net: 2398,
          currency: 'usd',
        },
      },
    },
  });

  assert.deepEqual(settlement, {
    paymentIntentId: 'pi_123',
    checkoutSessionId: null,
    chargeId: 'ch_123',
    balanceTransactionId: 'txn_123',
    amountCents: 2500,
    feeCents: 102,
    netCents: 2398,
    currency: 'usd',
  });
});

test('stripe reconciliation falls back through checkout session and charge fields', () => {
  const settlement = extractStripeSettlement({
    checkoutSession: {
      id: 'cs_test_123',
      amount_total: 1000,
      currency: 'usd',
    },
    charge: {
      id: 'ch_123',
      amount: 1000,
      balance_transaction: {
        id: 'txn_123',
        fee: 59,
        currency: 'usd',
      },
    },
  });

  assert.equal(settlement.checkoutSessionId, 'cs_test_123');
  assert.equal(settlement.amountCents, 1000);
  assert.equal(settlement.feeCents, 59);
  assert.equal(settlement.netCents, 941);
});
