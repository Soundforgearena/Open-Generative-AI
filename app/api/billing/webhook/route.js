import { callRpc, selectOne } from '../../../../lib/cinexvideo-server';
import { verifyWebhook, getSessionSettlement, PRODUCT_TAG } from '../../../../lib/stripe-connect';

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
  // Named per-product because the Stripe account is shared with several other
  // products. A generic name invites pointing the wrong signing secret at this
  // endpoint, which would silently reject every legitimate event.
  // The unprefixed name is accepted as a fallback so a deploy that lands before
  // the variable rename does not drop webhooks on the floor.
  const secret =
    process.env.CINEXVIDEO_STRIPE_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error('webhook received but CINEXVIDEO_STRIPE_WEBHOOK_SECRET is not set');
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

        // Stripe delivers every event on the account to every endpoint, and
        // this account is shared with other products that use overlapping pack
        // codes ('pro', 'studio', ...). Without this check a purchase made on
        // a sibling product could be fulfilled as CinexVideo credits.
        if (session.metadata?.product !== PRODUCT_TAG) {
          console.info('ignoring session from another product', session.id, session.metadata?.product);
          break;
        }

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

        const settlement = await getSessionSettlement(session);
        if (settlement.estimated) {
          console.warn('using estimated Stripe fee for', session.id);
        }

        // Idempotent in the database: a replayed webhook returns
        // already_fulfilled rather than granting a second time.
        const { ok, data } = await callRpc('fulfil_credit_purchase', {
          p_user_id: userId,
          p_credits: pack.credits,
          p_amount_cents: settlement.amountCents,
          p_fee_cents: settlement.feeCents,
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
      case 'charge.dispute.created': {
        const charge = event.data.object;
        if (charge?.metadata?.product !== PRODUCT_TAG) break;
        // Recorded for visibility. Credits are not clawed back automatically
        // because they may already be spent; this needs a human decision.
        console.warn('CinexVideo payment reversal', event.type, charge?.id, charge?.payment_intent);
        break;
      }

      default:
        break;
    }

    return Response.json({ received: true });
  } catch (err) {
    console.error('webhook handler', err);
    return new Response('Handler error', { status: 500 });
  }
}
