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
