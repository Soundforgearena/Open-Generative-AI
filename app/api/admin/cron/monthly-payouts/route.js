import { createTransfer, stripeEnabled, transferOutcomeUnknown } from '../../../../../lib/stripe-connect';
import { callRpc, selectOne, selectRows, updateRows, safeError } from '../../../../../lib/cinexvideo-server';

export const dynamic = 'force-dynamic';

// Stripe charges per payout, so tiny balances roll over to next month.
const MINIMUM_PAYOUT_CENTS = 1000;

function hasCronAuthorization(request) {
  const expected = process.env.CRON_SECRET?.trim();
  const provided = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  return Boolean(expected && provided && provided === expected);
}

/**
 * Monthly partner payouts, paid from the same ledger the cockpit shows.
 *
 * Each sale is split once, when it happens, by record_revenue() into
 * partner_earnings (net revenue, platform 30%, partners per their share).
 * This job only pays out what each partner has already earned and not yet
 * been paid. Earnings are attached to a single payout row before any money
 * moves, and that payout id is the Stripe idempotency key, so the same
 * earnings can never be paid twice, even if the job runs twice.
 */
export async function POST(request) {
  if (!hasCronAuthorization(request)) return safeError('Cron authorization required.', 401);
  if (!stripeEnabled()) return safeError('Stripe payouts are not configured.', 503);

  const balances = await selectRows(
    'partner_balances',
    { active: 'eq.true', order: 'share_percent.desc' },
    'partner_id,display_name,available_cents'
  );
  const summaries = [];

  for (const row of balances) {
    const available = Number(row.available_cents || 0);
    if (available < MINIMUM_PAYOUT_CENTS) {
      summaries.push({ partner: row.display_name, status: 'rolled_over', amount_cents: available });
      continue;
    }
    const partner = await selectOne('revenue_partners', { id: `eq.${row.partner_id}` });
    if (!partner?.stripe_account_id || partner.payout_provider !== 'stripe_express' || !partner.payouts_enabled) {
      summaries.push({ partner: row.display_name, status: 'waiting_for_stripe', amount_cents: available });
      continue;
    }

    const { ok, data: payoutId } = await callRpc('open_partner_payout_system', {
      p_partner_id: partner.id,
      p_note: `Monthly payout ${new Date().toISOString().slice(0, 7)}`,
    });
    if (!ok || !payoutId) {
      summaries.push({ partner: row.display_name, status: 'nothing_to_pay' });
      continue;
    }
    const payout = await selectOne('partner_payouts', { id: `eq.${payoutId}` });
    try {
      const transfer = await createTransfer({
        accountId: partner.stripe_account_id,
        amountCents: payout.amount_cents,
        payoutId,
        description: `CinexVideo partner payout - ${partner.display_name}`,
      });
      await callRpc('settle_partner_payout', { p_payout_id: payoutId, p_status: 'paid', p_provider_transfer_id: transfer.id });
      summaries.push({ partner: row.display_name, status: 'paid', amount_cents: payout.amount_cents, transfer_id: transfer.id });
    } catch (error) {
      if (transferOutcomeUnknown(error)) {
        await updateRows('partner_payouts', { id: `eq.${payoutId}` }, { note: 'Stripe did not confirm this transfer. Check the Stripe dashboard before retrying.' });
        summaries.push({ partner: row.display_name, status: 'needs_check', amount_cents: payout.amount_cents });
        continue;
      }
      // A definite failure releases the earnings back to available for next time.
      await callRpc('settle_partner_payout', { p_payout_id: payoutId, p_status: 'failed', p_provider_transfer_id: null });
      await updateRows('partner_payouts', { id: `eq.${payoutId}` }, { note: String(error.message || 'transfer failed').slice(0, 300) });
      summaries.push({ partner: row.display_name, status: 'failed', amount_cents: payout.amount_cents });
    }
  }

  return Response.json({ ok: summaries.every((s) => !['failed', 'needs_check'].includes(s.status)), summaries });
}
