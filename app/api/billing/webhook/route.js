import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { createClient } from '@supabase/supabase-js';
import { stripeEnabled, constructWebhookEvent } from '../../../../lib/stripe-connect';

// Webhooks are request-time only; nothing here may run during the build.
export const dynamic = 'force-dynamic';

const webhookSecret =
  process.env.CINEXVIDEO_STRIPE_WEBHOOK_SECRET ||
  process.env.STRIPE_WEBHOOK_SECRET;

/**
 * Lazily build the service-role Supabase client.
 *
 * Creating it at module scope crashes the build when the env vars are absent,
 * and it must never be created in a browser bundle.
 */
let cachedSupabase = null;
function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'Supabase is not configured: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.'
    );
  }
  if (!cachedSupabase) {
    cachedSupabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cachedSupabase;
}

export async function POST(req) {
  if (!stripeEnabled() || !webhookSecret) {
    return NextResponse.json(
      { error: 'Stripe webhooks are not configured on this deployment.' },
      { status: 503 }
    );
  }

  const body = await req.text();
  const signature = (await headers()).get('stripe-signature');

  let event;

  try {
    event = constructWebhookEvent(body, signature, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  // Only handle CinexVideo events if shared Stripe account
  const isCinexVideo =
    event.data?.object?.metadata?.product === 'cinexvideo' ||
    event.data?.object?.metadata?.cinexvideo_partner_id;

  // This Stripe account is shared by multiple products. A foreign checkout or
  // Connect event must be acknowledged before touching CinexVideo storage.
  if (
    (event.type === 'checkout.session.completed' ||
      event.type === 'checkout.session.async_payment_succeeded' ||
      event.type === 'payment_intent.payment_failed' ||
      event.type === 'account.updated') &&
    !isCinexVideo
  ) {
    return NextResponse.json({ received: true, ignored: true });
  }

  let supabase;
  try {
    supabase = getSupabase();
  } catch (err) {
    console.error('Webhook storage unavailable:', err.message);
    return NextResponse.json({ error: 'Storage not configured' }, { status: 503 });
  }

  // Idempotency: Stripe retries webhook deliveries on any non-2xx response or
  // timeout, so the same event.id can arrive more than once. Recording it
  // first (unique primary key) means a retry after a partial failure is
  // detected here instead of silently double-crediting a wallet.
  const { error: insertEventError } = await supabase
    .from('stripe_events')
    .insert({
      event_id: event.id,
      event_type: event.type,
      payload: event,
      status: 'processing',
      processing_started_at: new Date().toISOString(),
    });
  if (insertEventError) {
    if (insertEventError.code === '23505') {
      const { data: existingEvent } = await supabase
        .from('stripe_events')
        .select('status,processing_started_at')
        .eq('event_id', event.id)
        .single();
      if (existingEvent?.status === 'failed') {
        const { data: retryEvent, error: retryError } = await supabase
          .from('stripe_events')
          .update({
            status: 'processing',
            error_note: null,
            processing_started_at: new Date().toISOString(),
          })
          .eq('event_id', event.id)
          .eq('status', 'failed')
          .select('event_id')
          .maybeSingle();
        if (retryError || !retryEvent) return NextResponse.json({ error: 'Event is already being retried.' }, { status: 409 });
      } else if (
        existingEvent?.status === 'processing' &&
        existingEvent.processing_started_at &&
        Date.now() - new Date(existingEvent.processing_started_at).getTime() > 10 * 60 * 1000
      ) {
        const { data: retryEvent, error: retryError } = await supabase
          .from('stripe_events')
          .update({
            status: 'processing',
            error_note: null,
            processing_started_at: new Date().toISOString(),
          })
          .eq('event_id', event.id)
          .eq('status', 'processing')
          .eq('processing_started_at', existingEvent.processing_started_at)
          .select('event_id')
          .maybeSingle();
        if (retryError || !retryEvent) return NextResponse.json({ error: 'Event is already being retried.' }, { status: 409 });
      } else {
        // Already processed or currently processing this exact event.
        return NextResponse.json({ received: true, duplicate: true });
      }
    } else {
      console.error('Failed to record webhook event:', insertEventError.message);
      return NextResponse.json({ error: 'Storage not configured' }, { status: 503 });
    }
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        if (!isCinexVideo) break;
        const session = event.data.object;
        const userId = session.metadata?.user_id;
        const credits = parseInt(session.metadata?.credits || '0', 10);
        const paymentId = session.payment_intent || session.id;

        if (!userId || !credits) {
          console.warn('Invalid checkout session metadata', session);
          break;
        }
        if (!['paid', 'no_payment_required'].includes(session.payment_status)) {
          console.warn('Checkout completed before payment settled', session.id, session.payment_status);
          break;
        }

        // One database RPC records the payment, wallet and ledger atomically.
        const { error: purchaseError } = await supabase.rpc('fulfil_credit_purchase', {
          p_user_id: userId,
          p_credits: credits,
          p_amount_cents: session.amount_total,
          p_fee_cents: 0,
          p_provider: 'stripe',
          p_provider_payment_id: paymentId,
          p_currency: session.currency || 'usd',
          p_settled_amount_cents: session.amount_total,
          p_settled_currency: session.currency || 'usd',
        });
        if (purchaseError) throw purchaseError;
        break;
      }

      case 'payment_intent.payment_failed': {
        if (!isCinexVideo) break;
        const intent = event.data.object;
        console.warn('Payment failed', intent.id, intent.last_payment_error?.message);
        break;
      }

      case 'charge.refunded': {
        const charge = event.data.object;
        const paymentId = charge.payment_intent || charge.id;
        const { error: reversalError } = await supabase.rpc('process_stripe_credit_reversal', {
          p_event_id: event.id,
          p_provider_payment_id: paymentId,
          p_kind: 'refund',
          p_external_id: event.id,
          p_amount_cents: charge.amount_refunded || 0,
          p_dispute_status: null,
          p_reason: 'Refund issued: proportional unused credits clawed back.',
        });
        if (reversalError) throw reversalError;
        return NextResponse.json({ received: true });
      }

      case 'charge.dispute.created':
      case 'charge.dispute.closed': {
        const dispute = event.data.object;
        const paymentId = dispute.payment_intent || dispute.charge;
        const kind = event.type === 'charge.dispute.created' ? 'dispute_created' : 'dispute_closed';
        const won = kind === 'dispute_closed' && dispute.status === 'won';
        const note = won
          ? 'Dispute won: held credits restored.'
          : kind === 'dispute_created'
            ? 'Dispute opened: proportional unused credits held.'
            : `Dispute closed as ${dispute.status}: existing hold retained.`;
        const { error: reversalError } = await supabase.rpc('process_stripe_credit_reversal', {
          p_event_id: event.id,
          p_provider_payment_id: paymentId,
          p_kind: kind,
          p_external_id: dispute.id,
          p_amount_cents: dispute.amount || 0,
          p_dispute_status: dispute.status || null,
          p_reason: note,
        });
        if (reversalError) throw reversalError;
        return NextResponse.json({ received: true });
      }

      case 'account.updated': {
        const partnerId = event.data.object.metadata?.cinexvideo_partner_id;
        if (!partnerId) break;

        const account = event.data.object;
        const status = account.details_submitted ? 'onboarding_submitted' : 'needs_onboarding';

        await supabase
          .from('revenue_partners')
          .update({
            onboarding_status: status,
            updated_at: new Date().toISOString(),
          })
          .eq('id', partnerId);
        break;
      }

      case 'account.onboarding_finished': {
        const partnerId = event.data.object.metadata?.cinexvideo_partner_id;
        if (!partnerId) break;

        await supabase
          .from('revenue_partners')
          .update({
            onboarding_status: 'active',
            payouts_enabled: true,
            updated_at: new Date().toISOString(),
          })
          .eq('id', partnerId);
        break;
      }

      default:
        // Ignore unrelated events
        break;
    }

    await supabase
      .from('stripe_events')
      .update({ status: isCinexVideo ? 'processed' : 'ignored' })
      .eq('event_id', event.id);
    return NextResponse.json({ received: true });
  } catch (err) {
    console.error('Webhook handler error:', err);
    await supabase
      .from('stripe_events')
      .update({ status: 'failed', error_note: String(err?.message || err) })
      .eq('event_id', event.id);
    return NextResponse.json({ error: 'Handler failed' }, { status: 500 });
  }
}
