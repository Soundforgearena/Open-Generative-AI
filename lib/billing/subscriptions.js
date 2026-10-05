// Pure helpers for Stripe monthly plans (kept separate so they are testable).

/** Metadata we set on the subscription, wherever Stripe exposes it. */
export function subscriptionMetadata(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (obj.object === 'subscription') return obj.metadata || null;
  if (obj.object === 'invoice') {
    return (
      obj.subscription_details?.metadata ||
      obj.parent?.subscription_details?.metadata ||
      obj.lines?.data?.find((line) => line?.metadata?.product)?.metadata ||
      null
    );
  }
  return null;
}

const toIso = (seconds) => (Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : null);

/** Row for public.user_subscriptions from a Stripe subscription object. */
export function subscriptionRow(sub, metadata = {}) {
  const periodEnd = sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end;
  return {
    user_id: metadata.user_id || sub.metadata?.user_id,
    plan_code: metadata.plan_code || sub.metadata?.plan_code,
    stripe_customer_id: typeof sub.customer === 'string' ? sub.customer : sub.customer?.id || null,
    stripe_subscription_id: sub.id,
    status: sub.status,
    current_period_end: toIso(periodEnd),
    cancel_at_period_end: Boolean(sub.cancel_at_period_end),
    updated_at: new Date().toISOString(),
  };
}

/** What to grant for a paid plan invoice, or null when nothing should be granted. */
export function invoiceGrant(invoice) {
  const meta = subscriptionMetadata(invoice);
  if (!meta || meta.product !== 'cinexvideo' || !meta.user_id) return null;
  const amountCents = Number(invoice.amount_paid) || 0;
  if (amountCents <= 0) return null;
  const paymentId =
    (typeof invoice.payment_intent === 'string' ? invoice.payment_intent : invoice.payment_intent?.id) ||
    invoice.id;
  return {
    userId: meta.user_id,
    planCode: meta.plan_code,
    credits: parseInt(meta.credits || '0', 10),
    amountCents,
    currency: invoice.currency || 'usd',
    paymentId,
  };
}
