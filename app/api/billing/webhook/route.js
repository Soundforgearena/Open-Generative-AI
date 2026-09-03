import { callRpc, selectOne } from '../../../../lib/cinexvideo-server';
import { verifyWebhook, getSessionFeeCents } from '../../../../lib/stripe-connect';

// Signature verification needs the exact raw body, so this must not be cached
// or re-serialised anywhere in the request path.
export const dynamic = 'force-dynamic';

/**
 * Stripe webhook.
 *
 * This is the only place credits are granted from a purchase. The browser
 * returning to /?purchase=success is a UI hint, not proof of payment — a
 * customer who closes the tab still gets their credits, and a customer who
 * fakes the redirect gets nothing.
 */
export async function POST(request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error('webhook received but STRIPE_WEBHOOK_SECRET is not set');
    return new Response('Webhook not configured', { status: 503 });
  }

  const rawBody = await request.text();
  const signature = request.headers.get('stripe-signature');

  if (!(await verifyWebhook(rawBody, signature, secret))) {
    // Never reveal why. An attacker probing signatures learns nothing.
    return new Response('Invalid signature', { status: 400 });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response('Malformed payload', { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        if (session.payment_status !== 'paid') break;

        const userId = session.metadata?.user_id || session.client_reference_id;
        const packCode = session.metadata?.pack_code;
        if (!userId || !packCode) {
          console.error('checkout.session.completed missing metadata', session.id);
          break;
        }

        // Credits come from the database, not from the session metadata, so a
        // tampered session cannot mint credits.
        const pack = await selectOne('credit_packs', { code: `eq.${packCode}` }, 'credits,price_cents');
        if (!pack) {
          console.error('unknown pack in webhook', packCode);
          break;
        }

        const feeCents = await getSessionFeeCents(session);

        // Idempotent in the database: a replayed webhook returns
        // already_fulfilled rather than granting a second time.
        const { ok, data } = await callRpc('fulfil_credit_purchase', {
          p_user_id: userId,
          p_credits: pack.credits,
          p_amount_cents: session.amount_total,
          p_fee_cents: feeCents,
          p_provider: 'stripe',
          p_provider_payment_id: session.id,
        });

        if (!ok) {
          // Returning non-2xx makes Stripe retry, which is what we want.
          console.error('fulfilment failed', session.id, data);
          return new Response('Fulfilment failed', { status: 500 });
        }
        console.info('fulfilment', session.id, data?.status);
        break;
      }

      case 'charge.refunded':
      case 'charge.dispute.created':
        // Recorded for visibility. Credits are not clawed back automatically
        // because they may already be spent; this needs a human decision.
        console.warn('payment reversal', event.type, event.data.object?.id);
        break;

      default:
        break;
    }

    return Response.json({ received: true });
  } catch (err) {
    console.error('webhook handler', err);
    return new Response('Handler error', { status: 500 });
  }
}
