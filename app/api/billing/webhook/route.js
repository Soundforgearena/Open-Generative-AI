import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { createClient } from '@supabase/supabase-js';
import { stripeEnabled, constructWebhookEvent } from '../../../../lib/stripe-connect';
import { planChargebackResponse } from '../../../../lib/billing/chargeback-handler.js';

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
      case 'checkout.session.completed': {
        if (!isCinexVideo) break;
        const session = event.data.object;
        const userId = session.metadata?.user_id;
        const credits = parseInt(session.metadata?.credits || '0', 10);
        const paymentId = session.payment_intent || session.id;

        if (!userId || !credits) {
          console.warn('Invalid checkout session metadata', session);
          break;
        }

        // Record payment
        const { data: payment } = await supabase
          .from('payment_records')
          .insert({
            user_id: userId,
            provider: 'stripe',
            provider_payment_id: paymentId,
            amount_cents: session.amount_total,
            credits,
            status: 'completed',
            currency: 'usd',
          })
          .select()
          .single();

        // Update wallet
        await supabase.rpc('credit_wallets_add_purchase', {
          p_user_id: userId,
          p_credits: credits,
          p_amount_cents: session.amount_total,
        });

        // Ledger entry
        await supabase.from('credit_ledger').insert({
          user_id: userId,
          amount: credits,
          entry_type: 'purchase',
          reference_id: payment?.id,
          description: `Stripe checkout: ${credits} credits`,
        });
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
        const { data: payment } = await supabase
          .from('payment_records')
          .select('id,user_id,credits')
          .eq('provider_payment_id', paymentId)
          .single();
        if (!payment) break;

        const { data: wallet } = await supabase
          .from('credit_wallets')
          .select('lifetime_consumed')
          .eq('user_id', payment.user_id)
          .single();

        const plan = planChargebackResponse({
          kind: 'refund',
          creditsGrantedForPayment: payment.credits,
          creditsAlreadyConsumed: wallet?.lifetime_consumed || 0,
        });

        if (plan.clawBackCredits > 0) {
          await supabase.rpc('credit_wallets_add_purchase', {
            p_user_id: payment.user_id,
            p_credits: -plan.clawBackCredits,
            p_amount_cents: 0,
          });
          await supabase.from('credit_ledger').insert({
            user_id: payment.user_id,
            amount: -plan.clawBackCredits,
            entry_type: 'refund',
            reference_id: payment.id,
            description: plan.note,
          });
        }
        await supabase.from('refund_records').insert({
          payment_record_id: payment.id,
          stripe_refund_id: charge.refunds?.data?.[0]?.id || null,
          user_id: payment.user_id,
          amount_cents: charge.amount_refunded || 0,
          kind: 'refund',
          credits_clawed_back: plan.clawBackCredits,
        });
        break;
      }

      case 'charge.dispute.created':
      case 'charge.dispute.closed': {
        const dispute = event.data.object;
        const paymentId = dispute.payment_intent || dispute.charge;
        const { data: payment } = await supabase
          .from('payment_records')
          .select('id,user_id,credits')
          .eq('provider_payment_id', paymentId)
          .single();
        if (!payment) break;

        const { data: wallet } = await supabase
          .from('credit_wallets')
          .select('lifetime_consumed')
          .eq('user_id', payment.user_id)
          .single();

        const kind = event.type === 'charge.dispute.created' ? 'dispute_created' : 'dispute_closed';
        const plan = planChargebackResponse({
          kind,
          disputeStatus: dispute.status,
          creditsGrantedForPayment: payment.credits,
          creditsAlreadyConsumed: wallet?.lifetime_consumed || 0,
        });

        const netCreditDelta = (plan.restoreCredits || 0) - (plan.clawBackCredits || 0);
        if (netCreditDelta !== 0) {
          await supabase.rpc('credit_wallets_add_purchase', {
            p_user_id: payment.user_id,
            p_credits: netCreditDelta,
            p_amount_cents: 0,
          });
          await supabase.from('credit_ledger').insert({
            user_id: payment.user_id,
            amount: netCreditDelta,
            entry_type: netCreditDelta >= 0 ? 'adjustment' : 'refund',
            reference_id: payment.id,
            description: plan.note,
          });
        }
        await supabase.from('refund_records').insert({
          payment_record_id: payment.id,
          stripe_dispute_id: dispute.id,
          user_id: payment.user_id,
          amount_cents: dispute.amount || 0,
          kind,
          credits_clawed_back: plan.clawBackCredits || 0,
        });
        if (plan.flagAccount) {
          await supabase.from('financial_audit_events').insert({
            user_id: payment.user_id,
            event_type: 'account_flagged_chargeback',
            details: { dispute_id: dispute.id, status: dispute.status, note: plan.note },
          });
        }
        break;
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
