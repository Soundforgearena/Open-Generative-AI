import {
  guard,
  selectOne,
  selectRows,
  updateRows,
  callRpc,
  callRpcAsUser,
  bearerToken,
  safeError,
} from '../../../../lib/cinexvideo-server';
import { stripeEnabled, createTransfer } from '../../../../lib/stripe-connect';

/** Payout history. */
export async function GET(request) {
  const { error } = await guard(request, { requireSuperAdmin: true });
  if (error) return error;
  const payouts = await selectRows('partner_payouts', { order: 'created_at.desc', limit: '50' });
  const partners = await selectRows('revenue_partners', {}, 'id,display_name,email');
  const byId = Object.fromEntries(partners.map((partner) => [partner.id, partner]));
  return Response.json({
    payouts: payouts.map((payout) => ({ ...payout, partner: byId[payout.partner_id] || null })),
  });
}

/**
 * Opens a payout for a partner's unpaid earnings and, when Stripe is
 * configured and the partner is onboarded, sends it immediately.
 *
 * The payout row is created first and used as the Stripe idempotency key, so a
 * network failure mid-transfer can be retried without paying twice. If the
 * transfer fails, the earnings are released back to available.
 */
export async function POST(request) {
  const { error } = await guard(request, { requireSuperAdmin: true });
  if (error) return error;

  try {
    const body = await request.json();
    const partnerId = body.partner_id;
    if (!partnerId) return safeError('Choose a partner to pay.');

    const partner = await selectOne('revenue_partners', { id: `eq.${partnerId}` });
    if (!partner) return safeError('Unknown partner.', 404);

    const useStripe =
      body.method !== 'manual' &&
      stripeEnabled() &&
      partner.payout_provider === 'stripe_express' &&
      partner.stripe_account_id &&
      partner.payouts_enabled;

    const { ok, data: payoutId } = await callRpcAsUser(
      'open_partner_payout',
      {
        p_partner_id: partnerId,
        p_provider: useStripe ? 'stripe_express' : 'manual',
        p_note: body.note || null,
      },
      bearerToken(request)
    );
    if (!ok || !payoutId) return safeError('There is nothing available to pay out.', 400);

    const payout = await selectOne('partner_payouts', { id: `eq.${payoutId}` });

    if (!useStripe) {
      return Response.json({
        payout_id: payoutId,
        amount_cents: payout.amount_cents,
        status: 'pending',
        method: 'manual',
        message: stripeEnabled()
          ? 'Payout recorded. This partner has not finished Stripe onboarding, so settle it manually and mark it paid.'
          : 'Payout recorded in manual mode. Send the funds, then mark it paid.',
      });
    }

    try {
      const transfer = await createTransfer({
        accountId: partner.stripe_account_id,
        amountCents: payout.amount_cents,
        payoutId,
        description: `CinexVideo partner payout — ${partner.display_name}`,
      });
      await callRpc('settle_partner_payout', {
        p_payout_id: payoutId,
        p_status: 'paid',
        p_provider_transfer_id: transfer.id,
      });
      return Response.json({
        payout_id: payoutId,
        amount_cents: payout.amount_cents,
        status: 'paid',
        method: 'stripe_express',
        transfer_id: transfer.id,
      });
    } catch (transferError) {
      await callRpc('settle_partner_payout', { p_payout_id: payoutId, p_status: 'failed' });
      await updateRows('partner_payouts', { id: `eq.${payoutId}` }, { note: transferError.message });
      console.error('stripe transfer', transferError);
      return safeError(`Transfer failed: ${transferError.message}. The earnings were returned to available.`, 502);
    }
  } catch (err) {
    console.error('payout', err);
    return safeError('Could not process the payout.', 500);
  }
}

/** Mark a manual payout as paid, failed, or cancelled. */
export async function PATCH(request) {
  const { error } = await guard(request, { requireSuperAdmin: true });
  if (error) return error;
  try {
    const body = await request.json();
    if (!['paid', 'failed', 'cancelled'].includes(body.status)) {
      return safeError('Status must be paid, failed, or cancelled.');
    }
    await callRpc('settle_partner_payout', {
      p_payout_id: body.payout_id,
      p_status: body.status,
      p_provider_transfer_id: body.reference || null,
    });
    return Response.json({ ok: true });
  } catch (err) {
    console.error('payout patch', err);
    return safeError('Could not update the payout.', 500);
  }
}
