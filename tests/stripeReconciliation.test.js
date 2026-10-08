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

const { fetchStripeSettlement, reconcileStripeRecords, sanitizeStripeError } = require('../lib/billing/stripe-reconciliation.js');

const expandedPi = {
  id: 'pi_1',
  currency: 'usd',
  amount_received: 2500,
  latest_charge: { id: 'ch_1', balance_transaction: { id: 'txn_1', fee: 100, net: 2400, currency: 'usd' } },
};

function fakeStripe(overrides = {}) {
  return {
    paymentIntents: { retrieve: async () => expandedPi },
    checkout: { sessions: { retrieve: async () => ({ id: 'cs_1', payment_intent: expandedPi }) } },
    charges: {
      retrieve: async () => ({ id: 'ch_1', amount: 2500, currency: 'usd', balance_transaction: { id: 'txn_1', fee: 100, net: 2400 } }),
    },
    ...overrides,
  };
}

test('fetchStripeSettlement handles payment intents, sessions and charges', async () => {
  const stripe = fakeStripe();
  assert.equal((await fetchStripeSettlement(stripe, 'pi_1')).feeCents, 100);
  assert.equal((await fetchStripeSettlement(stripe, 'cs_1')).balanceTransactionId, 'txn_1');
  assert.equal((await fetchStripeSettlement(stripe, 'ch_1')).amountCents, 2500);
  await assert.rejects(() => fetchStripeSettlement(stripe, 'xx_1'), /Unsupported/);
});

test('fetchStripeSettlement rejects non-success and malformed responses', async () => {
  const withStatus = Object.defineProperty({ ...expandedPi }, 'lastResponse', { value: { statusCode: 203 } });
  await assert.rejects(
    () => fetchStripeSettlement(fakeStripe({ paymentIntents: { retrieve: async () => withStatus } }), 'pi_1'),
    (e) => e.status === 203 && /non-success/.test(e.message)
  );
  for (const bad of [null, 'ok', [], {}, { id: 'ch_9' }]) {
    await assert.rejects(
      () => fetchStripeSettlement(fakeStripe({ paymentIntents: { retrieve: async () => bad } }), 'pi_1'),
      /malformed/
    );
  }
});

test('reconcileStripeRecords continues per record and logs sanitized errors', async () => {
  const secret = 'sk_live_SECRET';
  const stripe = fakeStripe({
    paymentIntents: {
      retrieve: async (id) => {
        if (id === 'pi_bad') {
          const err = new Error(`Invalid key ${secret}`);
          err.type = 'StripeAPIError';
          err.statusCode = 503;
          throw err;
        }
        return expandedPi;
      },
    },
  });
  const writes = [];
  const logs = [];
  const result = await reconcileStripeRecords({
    targets: [
      { id: 1, provider_payment_id: 'pi_bad' },
      { id: 2, provider_payment_id: 'weird_1' },
      { id: 3, provider_payment_id: 'pi_1' },
    ],
    stripe,
    insertRows: async (t, row) => { writes.push([t, row]); return { ok: true }; },
    updateRows: async (t, f, row) => { writes.push([t, f, row]); return { ok: true }; },
    logger: { error: (...a) => logs.push(a) },
  });
  assert.deepEqual(result, { updated: 1, pending: 0, errors: 2 });
  assert.equal(writes.length, 2);
  assert.equal(writes[1][1].id, 'eq.3');
  assert.equal(logs.length, 2);
  assert.ok(!JSON.stringify(logs).includes(secret));
  assert.equal(logs[0][2].status, 503);
});

test('sanitizeStripeError strips unsafe content', () => {
  const out = sanitizeStripeError({ name: 'E', type: 'x y<z>', raw: { secret: 1 }, message: 'sk_live_1' });
  assert.deepEqual(out, { name: 'E', type: 'xyz', code: null, status: null, message: null });
});
