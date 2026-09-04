import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
});

const webhookSecret =
  process.env.CINEXVIDEO_STRIPE_WEBHOOK_SECRET ||
  process.env.STRIPE_WEBHOOK_SECRET;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function POST(req) {
  const body = await req.text();
  const signature = headers().get('stripe-signature');

  let event;

  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  // Only handle CinexVideo events if shared Stripe account
  const isCinexVideo =
    event.data?.object?.metadata?.product === 'cinexvideo' ||
    event.data?.object?.metadata?.cinexvideo_partner_id;

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
