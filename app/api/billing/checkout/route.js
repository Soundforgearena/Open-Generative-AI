import { guard, selectOne, selectRows, safeError } from '../../../../lib/cinexvideo-server';
import { stripeEnabled, createCheckoutSession } from '../../../../lib/stripe-connect';
import { currentPaymentMode } from '../../../../lib/billing/payment-mode-server';
import { canCheckout } from '../../../../lib/billing/payment-mode';

/** Customer-facing credit packs. Prices only — no cost or margin data. */
export async function GET(request) {
  const { error, admin } = await guard(request);
  if (error) return error;
  const mode = await currentPaymentMode();
  const packs = await selectRows(
    'credit_packs',
    { active: 'eq.true', order: 'sort_order.asc' },
    'code,name,credits,price_cents,blurb'
  );
  return Response.json({
    packs: packs.map((pack) => ({
      ...pack,
      // Shown as a value cue; still derived from the public price only.
      credits_per_dollar: Math.round((pack.credits / (pack.price_cents / 100)) * 10) / 10,
    })),
    checkout_enabled: stripeEnabled(mode) && canCheckout(mode, { admin }),
    sandbox: mode === 'test',
  });
}

/** Starts a hosted Stripe Checkout session for the chosen pack. */
export async function POST(request) {
  const { user, admin, error } = await guard(request);
  if (error) return error;
  const mode = await currentPaymentMode();
  if (!canCheckout(mode, { admin })) {
    return safeError('Credit purchases open soon.', 503);
  }

  if (!stripeEnabled(mode)) {
    return safeError('Credit purchases are not available on this deployment yet.', 503);
  }

  try {
    const body = await request.json();
    // The price is read from the database, never from the request body, so a
    // customer cannot choose what they pay.
    const pack = await selectOne('credit_packs', { code: `eq.${body.pack_code}`, active: 'eq.true' });
    if (!pack) return safeError('That credit pack is not available.', 404);

    const origin = process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin;
    const session = await createCheckoutSession({
      pack,
      userId: user.id,
      userEmail: user.email,
      successUrl: `${origin}/?purchase=success`,
      cancelUrl: `${origin}/?purchase=cancelled`,
      mode,
    });

    return Response.json({ url: session.url, session_id: session.id });
  } catch (err) {
    console.error('checkout', err);
    return safeError('Could not start checkout. Please try again.', 502);
  }
}
