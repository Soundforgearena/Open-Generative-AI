export function stripeConnectionStatus(env = process.env) {
  return { connected: Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET), status: env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET ? 'configured' : 'unavailable', reason: 'Verified Stripe webhook and balance-transaction ingestion is not configured in this deployment.' };
}

export function normalizeVerifiedStripePayment(event) {
  if (!event || event.type !== 'payment_intent.succeeded') return null;
  return { providerEventId: event.id, amountCents: Number(event.data?.object?.amount_received || 0), currency: event.data?.object?.currency || null, verified: true };
}
