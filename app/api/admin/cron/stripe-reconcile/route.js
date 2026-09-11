import {
  insertRows,
  safeError,
  selectRows,
  updateRows,
} from '../../../../../lib/cinexvideo-server';
import { getStripe, stripeEnabled } from '../../../../../lib/stripe-connect';
import {
  extractStripeSettlement,
  looksLikeStripeCharge,
  looksLikeStripeCheckoutSession,
  looksLikeStripePaymentIntent,
} from '../../../../../lib/billing/stripe-reconciliation.js';

export const dynamic = 'force-dynamic';

async function fetchStripeSettlement(providerPaymentId) {
  const stripe = getStripe();

  if (looksLikeStripePaymentIntent(providerPaymentId)) {
    const paymentIntent = await stripe.paymentIntents.retrieve(providerPaymentId, {
      expand: ['latest_charge.balance_transaction'],
    });
    return extractStripeSettlement({ paymentIntent });
  }

  if (looksLikeStripeCheckoutSession(providerPaymentId)) {
    const session = await stripe.checkout.sessions.retrieve(providerPaymentId, {
      expand: ['payment_intent.latest_charge.balance_transaction'],
    });
    return extractStripeSettlement({
      checkoutSession: session,
      paymentIntent: session.payment_intent,
    });
  }

  if (looksLikeStripeCharge(providerPaymentId)) {
    const charge = await stripe.charges.retrieve(providerPaymentId, {
      expand: ['balance_transaction'],
    });
    return extractStripeSettlement({ charge });
  }

  throw new Error('Unsupported Stripe payment reference');
}

export async function POST(request) {
  const expected = process.env.CRON_SECRET;
  const provided = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!expected || !provided || provided !== expected) return safeError('Cron authorization required.', 401);
  if (!stripeEnabled()) return safeError('Stripe reconciliation is not configured for this deployment.', 503);

  try {
    const records = await selectRows(
      'payment_records',
      { provider: 'eq.stripe', order: 'created_at.asc', limit: 100 },
      'id,provider_payment_id,fee_cents,settled_amount_cents,settled_currency'
    );

    const targets = records.filter((record) =>
      record.provider_payment_id
      && (
        !Number.isInteger(Number(record.fee_cents))
        || Number(record.fee_cents) === 0
        || !Number.isInteger(Number(record.settled_amount_cents))
        || !String(record.settled_currency || '').trim()
      )
    );

    const summary = {
      checked: records.length,
      targeted: targets.length,
      updated: 0,
      unchanged: 0,
      pending: 0,
      errors: 0,
    };

    for (const record of targets) {
      try {
        const settlement = await fetchStripeSettlement(record.provider_payment_id);
        if (
          !settlement.balanceTransactionId
          || settlement.amountCents === null
          || settlement.feeCents === null
          || !settlement.currency
        ) {
          summary.pending += 1;
          continue;
        }

        const feeWrite = await insertRows(
          'payment_fee_records',
          {
            payment_record_id: record.id,
            stripe_balance_transaction_id: settlement.balanceTransactionId,
            fee_cents: settlement.feeCents,
            net_cents: settlement.netCents ?? settlement.amountCents - settlement.feeCents,
            currency: settlement.currency,
          },
          { upsert: true }
        );
        if (!feeWrite.ok) throw new Error('fee record write failed');

        const paymentUpdate = await updateRows(
          'payment_records',
          { id: `eq.${record.id}` },
          {
            fee_cents: settlement.feeCents,
            settled_amount_cents: settlement.amountCents,
            settled_currency: settlement.currency,
          }
        );
        if (!paymentUpdate.ok) throw new Error('payment record update failed');

        summary.updated += 1;
      } catch (error) {
        summary.errors += 1;
        console.error('stripe reconciliation failed', record.id, error);
      }
    }

    summary.unchanged = Math.max(0, summary.checked - summary.targeted);

    await insertRows('admin_metric_events', {
      event_type: 'stripe_reconciliation',
      status: summary.errors ? 'partial' : 'completed',
    });

    return Response.json({ status: summary.errors ? 'partial' : 'ok', ...summary });
  } catch (error) {
    console.error('stripe reconcile cron', error);
    return safeError('Stripe reconciliation failed.', 500);
  }
}
