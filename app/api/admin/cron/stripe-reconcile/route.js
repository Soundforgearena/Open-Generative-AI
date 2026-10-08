import {
  insertRows,
  safeError,
  selectRows,
  updateRows,
} from '../../../../../lib/cinexvideo-server';
import { getStripe, stripeEnabled } from '../../../../../lib/stripe-connect';
import {
  reconcileStripeRecords,
  sanitizeStripeError,
} from '../../../../../lib/billing/stripe-reconciliation.js';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  const expected = process.env.CRON_SECRET;
  const provided = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!expected || !provided || provided !== expected) return safeError('Cron authorization required.', 401);
  if (!stripeEnabled()) return safeError('Stripe reconciliation is not configured for this deployment.', 503);

  try {
    const records = await selectRows(
      'payment_records',
      {
        provider: 'eq.stripe',
        provider_payment_id: 'not.is.null',
        // Only rows still missing settlement data, so newer payments are never
        // starved behind the first 100 already-reconciled ones.
        or: '(fee_cents.is.null,fee_cents.eq.0,settled_amount_cents.is.null,settled_currency.is.null)',
        order: 'created_at.asc',
        limit: 100,
      },
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

    const result = await reconcileStripeRecords({
      targets,
      stripe: getStripe(),
      insertRows,
      updateRows,
    });
    summary.updated = result.updated;
    summary.pending = result.pending;
    summary.errors = result.errors;

    summary.unchanged = Math.max(0, summary.checked - summary.targeted);

    await insertRows('admin_metric_events', {
      event_type: 'stripe_reconciliation',
      status: summary.errors ? 'partial' : 'completed',
    });

    return Response.json({ status: summary.errors ? 'partial' : 'ok', ...summary });
  } catch (error) {
    console.error('stripe reconcile cron', sanitizeStripeError(error));
    return safeError('Stripe reconciliation failed.', 500);
  }
}
