import { createTransfer, stripeEnabled } from '../../../../../lib/stripe-connect';
import {
  calculateMonthlyContractorPayouts,
  payoutPeriodBounds,
} from '../../../../../lib/contractor-payouts.js';
import {
  insertRows,
  selectRows,
  updateRows,
  safeError,
} from '../../../../../lib/cinexvideo-server';

export const dynamic = 'force-dynamic';

function hasCronAuthorization(request) {
  const expected = process.env.CRON_SECRET?.trim();
  const provided = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  return Boolean(expected && provided && provided === expected);
}

function payoutRowFromResult(result, partner, period) {
  return {
    partner_id: partner.id,
    period,
    amount_cents: result.cappedShareCents,
    raw_share_cents: result.rawShareCents,
    excess_to_platform_cents: result.excessToPlatformCents,
    provider: 'stripe_express',
    status: 'pending',
    note: `Monthly contractor payout for ${period}`,
  };
}

/**
 * Runs a monthly contractor payout from server-derived revenue_events.
 * The request accepts only the period; revenue is never trusted from a
 * client, cron body, or admin form.
 */
export async function POST(request) {
  if (!hasCronAuthorization(request)) return safeError('Cron authorization required.', 401);
  if (!stripeEnabled()) return safeError('Stripe payouts are not configured.', 503);

  try {
    const body = await request.json().catch(() => ({}));
    const { period } = body;
    const bounds = payoutPeriodBounds(period);

    const [revenueEvents, partners] = await Promise.all([
      selectRows(
        'revenue_events',
        {
          created_at: [`gte.${bounds.start}`, `lt.${bounds.end}`],
          limit: 10000,
        },
        'gross_cents'
      ),
      selectRows(
        'revenue_partners',
        { active: 'eq.true', order: 'email.asc' },
        'id,email,display_name,stripe_account_id,payout_provider,payouts_enabled,contractor_key,payout_units'
      ),
    ]);

    const totalRevenueCents = revenueEvents.reduce(
      (total, event) => total + Math.max(0, Number(event.gross_cents) || 0),
      0
    );
    const configuredPartners = partners
      .filter((partner) => Number.isInteger(partner.payout_units) && partner.payout_units > 0)
      .map((partner) => ({
        ...partner,
        key: partner.contractor_key,
        units: partner.payout_units,
      }));
    const calculation = calculateMonthlyContractorPayouts({
      totalRevenueCents,
      contractors: configuredPartners,
    });
    const summaries = [];

    for (const result of calculation.payouts) {
      if (result.cappedShareCents <= 0) {
        summaries.push({ key: result.key, status: 'skipped', amount_cents: 0 });
        continue;
      }
      if (!result.stripe_account_id || result.payout_provider !== 'stripe_express' || !result.payouts_enabled) {
        summaries.push({ key: result.key, status: 'blocked', reason: 'Stripe Express onboarding is incomplete.' });
        continue;
      }

      const existingRows = await selectRows(
        'partner_payouts',
        { partner_id: `eq.${result.id}`, period: `eq.${period}`, limit: 1 },
        '*'
      );
      let payout = existingRows[0];
      if (payout?.status === 'paid') {
        summaries.push({ key: result.key, status: 'paid', amount_cents: payout.amount_cents, transfer_id: payout.provider_transfer_id });
        continue;
      }

      if (!payout) {
        const created = await insertRows('partner_payouts', payoutRowFromResult(result, result, period));
        if (!created.ok) {
          const retryRows = await selectRows(
            'partner_payouts',
            { partner_id: `eq.${result.id}`, period: `eq.${period}`, limit: 1 },
            '*'
          );
          payout = retryRows[0];
        } else {
          payout = Array.isArray(created.data) ? created.data[0] : created.data;
        }
      }
      if (!payout?.id) {
        summaries.push({ key: result.key, status: 'failed', reason: 'Could not create payout record.' });
        continue;
      }

      try {
        const transfer = await createTransfer({
          accountId: result.stripe_account_id,
          amountCents: payout.amount_cents,
          payoutId: payout.id,
          description: `CinexVideo contractor payout - ${result.key} - ${period}`,
        });
        await updateRows(
          'partner_payouts',
          { id: `eq.${payout.id}` },
          { status: 'paid', provider_transfer_id: transfer.id, completed_at: new Date().toISOString() }
        );
        summaries.push({ key: result.key, status: 'paid', amount_cents: payout.amount_cents, transfer_id: transfer.id });
      } catch (error) {
        await updateRows('partner_payouts', { id: `eq.${payout.id}` }, { status: 'failed', note: error.message });
        summaries.push({ key: result.key, status: 'failed', amount_cents: payout.amount_cents, reason: 'Stripe transfer failed.' });
      }
    }

    return Response.json({
      ok: summaries.every((summary) => ['paid', 'skipped'].includes(summary.status)),
      period,
      totalRevenueCents,
      contractorPoolCents: calculation.contractorPoolCents,
      totalCappedToPlatformCents: calculation.totalCappedToPlatformCents,
      summaries,
    });
  } catch (error) {
    console.error('monthly contractor payouts', error);
    return safeError(error.message || 'Could not run monthly contractor payouts.', 500);
  }
}
