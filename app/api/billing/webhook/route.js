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

  let supabase;
  try {
    supabase = getSupabase();
  } catch (err) {
    console.error('Webhook storage unavailable:', err.message);
    return NextResponse.json({ error: 'Storage not configured' }, { status: 503 });
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

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error('Webhook handler error:', err);
    return NextResponse.json({ error: 'Handler failed' }, { status: 500 });
  }
}
