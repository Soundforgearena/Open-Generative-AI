function objectOrNull(value) {
  return value && typeof value === 'object' ? value : null;
}

function integerOrNull(value) {
  return Number.isInteger(value) ? value : null;
}

export function looksLikeStripePaymentIntent(id) {
  return typeof id === 'string' && id.startsWith('pi_');
}

export function looksLikeStripeCheckoutSession(id) {
  return typeof id === 'string' && id.startsWith('cs_');
}

export function looksLikeStripeCharge(id) {
  return typeof id === 'string' && id.startsWith('ch_');
}

export function extractStripeSettlement(source = {}) {
  const paymentIntent = objectOrNull(source.paymentIntent) || objectOrNull(source.payment_intent) || null;
  const checkoutSession = objectOrNull(source.checkoutSession) || objectOrNull(source.checkout_session) || null;
  const chargeSource =
    objectOrNull(source.charge) ||
    objectOrNull(paymentIntent?.latest_charge) ||
    objectOrNull(paymentIntent?.charges?.data?.[0]) ||
    null;
  const balanceTransaction = objectOrNull(chargeSource?.balance_transaction) || null;

  const amountCents =
    integerOrNull(paymentIntent?.amount_received) ??
    integerOrNull(chargeSource?.amount_captured) ??
    integerOrNull(chargeSource?.amount) ??
    integerOrNull(checkoutSession?.amount_total) ??
    null;
  const feeCents = integerOrNull(balanceTransaction?.fee);
  const netCents =
    integerOrNull(balanceTransaction?.net) ??
    (amountCents !== null && feeCents !== null ? amountCents - feeCents : null);
  const currency =
    String(
      paymentIntent?.currency ||
        chargeSource?.currency ||
        balanceTransaction?.currency ||
        checkoutSession?.currency ||
        ''
    )
      .trim()
      .toLowerCase() || null;

  return {
    paymentIntentId: paymentIntent?.id || null,
    checkoutSessionId: checkoutSession?.id || null,
    chargeId: chargeSource?.id || null,
    balanceTransactionId: balanceTransaction?.id || null,
    amountCents,
    feeCents,
    netCents,
    currency,
  };
}

const MAX_LOG_FIELD = 80;

function safeToken(value) {
  const text = String(value ?? '').replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, MAX_LOG_FIELD);
  return text || null;
}

export function sanitizeStripeError(error) {
  return {
    name: safeToken(error?.name) || 'Error',
    type: safeToken(error?.type),
    code: safeToken(error?.code),
    status: Number.isInteger(error?.statusCode) ? error.statusCode : Number.isInteger(error?.status) ? error.status : null,
    message: typeof error?.stripeReconcile === 'string' ? error.stripeReconcile : null,
  };
}

function reconcileError(message, status = null) {
  const error = new Error(message);
  error.stripeReconcile = message;
  error.status = status;
  return error;
}

function assertStripeResponse(response, prefix, label) {
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    throw reconcileError(`Stripe ${label} response malformed`);
  }
  const status = response.lastResponse?.statusCode ?? response.statusCode ?? response.status;
  if (Number.isInteger(status) && status !== 200) {
    throw reconcileError(`Stripe ${label} retrieval returned non-success status`, status);
  }
  if (typeof response.id !== 'string' || !response.id.startsWith(prefix)) {
    throw reconcileError(`Stripe ${label} response malformed`, Number.isInteger(status) ? status : null);
  }
  return response;
}

export async function fetchStripeSettlement(stripe, providerPaymentId) {
  if (looksLikeStripePaymentIntent(providerPaymentId)) {
    const paymentIntent = assertStripeResponse(
      await stripe.paymentIntents.retrieve(providerPaymentId, { expand: ['latest_charge.balance_transaction'] }),
      'pi_',
      'payment intent'
    );
    return extractStripeSettlement({ paymentIntent });
  }

  if (looksLikeStripeCheckoutSession(providerPaymentId)) {
    const session = assertStripeResponse(
      await stripe.checkout.sessions.retrieve(providerPaymentId, {
        expand: ['payment_intent.latest_charge.balance_transaction'],
      }),
      'cs_',
      'checkout session'
    );
    return extractStripeSettlement({ checkoutSession: session, paymentIntent: session.payment_intent });
  }

  if (looksLikeStripeCharge(providerPaymentId)) {
    const charge = assertStripeResponse(
      await stripe.charges.retrieve(providerPaymentId, { expand: ['balance_transaction'] }),
      'ch_',
      'charge'
    );
    return extractStripeSettlement({ charge });
  }

  throw reconcileError('Unsupported Stripe payment reference');
}

export async function reconcileStripeRecords({ targets, stripe, insertRows, updateRows, logger = console }) {
  const summary = { updated: 0, pending: 0, errors: 0 };

  for (const record of targets) {
    try {
      const settlement = await fetchStripeSettlement(stripe, record.provider_payment_id);
      if (
        !settlement.balanceTransactionId
        || settlement.amountCents === null
        || settlement.feeCents === null
        || !settlement.currency
      ) {
        summary.pending += 1;
        continue;
      }

      const feeWrite = await insertRows(
        'payment_fee_records',
        {
          payment_record_id: record.id,
          stripe_balance_transaction_id: settlement.balanceTransactionId,
          fee_cents: settlement.feeCents,
          net_cents: settlement.netCents ?? settlement.amountCents - settlement.feeCents,
          currency: settlement.currency,
        },
        { upsert: true }
      );
      if (!feeWrite.ok) throw reconcileError('fee record write failed');

      const paymentUpdate = await updateRows(
        'payment_records',
        { id: `eq.${record.id}` },
        {
          fee_cents: settlement.feeCents,
          settled_amount_cents: settlement.amountCents,
          settled_currency: settlement.currency,
        }
      );
      if (!paymentUpdate.ok) throw reconcileError('payment record update failed');

      summary.updated += 1;
    } catch (error) {
      summary.errors += 1;
      logger.error('stripe reconciliation failed', record.id, sanitizeStripeError(error));
    }
  }

  return summary;
}
