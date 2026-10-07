import { guard, insertRows, selectOne, selectRows, updateRows, safeError } from '../../../../lib/cinexvideo-server';
import {
  stripeEnabled,
  createExpressAccount,
  createOnboardingLink,
  createDashboardLink,
  getAccount,
  summariseAccount,
  payoutCountries,
  canOnboardCountry,
  getStripe,
} from '../../../../lib/stripe-connect';

/**
 * Stripe Express onboarding, self-service.
 *
 * A partner onboards themselves — the platform never handles their bank
 * details or identity documents, Stripe does. A super admin may onboard on
 * behalf of another partner by passing partner_id.
 */
async function resolvePartner(request, user, superAdmin, partnerId) {
  if (partnerId && superAdmin) return selectOne('revenue_partners', { id: `eq.${partnerId}` });
  return selectOne('revenue_partners', { user_id: `eq.${user.id}` });
}

/** Current onboarding + payout status for the calling partner. */
export async function GET(request) {
  const { user, superAdmin, error } = await guard(request);
  if (error) return error;

  const url = new URL(request.url);
  const partner = await resolvePartner(request, user, superAdmin, url.searchParams.get('partner_id'));
  if (!partner) return Response.json({ is_partner: false });

  const base = {
    is_partner: true,
    partner_id: partner.id,
    display_name: partner.display_name,
    // The split is super admin only; partners see just their payout setup.
    ...(superAdmin ? { share_percent: partner.share_percent } : {}),
    payout_provider: partner.payout_provider,
    payout_country: partner.payout_country || null,
    countries: payoutCountries(),
    stripe_configured: stripeEnabled(),
  };

  if (!stripeEnabled() || !partner.stripe_account_id) {
    return Response.json({ ...base, onboarding_status: partner.stripe_account_id ? 'unknown' : 'not_started', payouts_enabled: false });
  }

  try {
    const summary = summariseAccount(await getAccount(partner.stripe_account_id));
    await updateRows(
      'revenue_partners',
      { id: `eq.${partner.id}` },
      { payouts_enabled: summary.payouts_enabled, onboarding_status: summary.onboarding_status }
    );
    return Response.json({ ...base, ...summary });
  } catch (err) {
    console.error('stripe status', err);
    return Response.json({ ...base, onboarding_status: 'unknown', payouts_enabled: false });
  }
}

/**
 * Creates the Express account if needed and returns a fresh onboarding link.
 * Onboarding links are single-use and short-lived, so this is called every
 * time the partner clicks through rather than being stored.
 */
export async function POST(request) {
  const { user, superAdmin, error } = await guard(request);
  if (error) return error;

  if (!stripeEnabled()) {
    return safeError('Stripe payouts are not configured on this deployment yet.', 503);
  }

  try {
    const body = await request.json().catch(() => ({}));
    const partner = await resolvePartner(request, user, superAdmin, body.partner_id);
    if (!partner) return safeError('You are not set up as a revenue partner.', 403);

    let accountId = partner.stripe_account_id;

    if (!accountId) {
      const country = String(body.country || partner.payout_country || '').toUpperCase();
      if (!canOnboardCountry(country)) {
        return safeError(
          'Choose the country where your bank account is. If your country is not listed, Stripe Express payouts are not available there yet; your earnings are kept safe until they are.',
          400
        );
      }
      const account = await createExpressAccount({
        email: partner.email,
        country,
        businessUrl: process.env.NEXT_PUBLIC_SITE_URL,
        partnerId: partner.id,
        displayName: partner.display_name,
      });
      // One Stripe account per partner: only claim the slot if it is still
      // empty, so a double click can never create two payout accounts.
      const claimed = await updateRows(
        'revenue_partners',
        { id: `eq.${partner.id}`, stripe_account_id: 'is.null' },
        {
          stripe_account_id: account.id,
          payout_provider: 'stripe_express',
          payout_country: country,
          onboarding_status: 'action_required',
          updated_at: new Date().toISOString(),
        }
      );
      if (claimed.ok && Array.isArray(claimed.data) && claimed.data.length === 1) {
        accountId = account.id;
      } else {
        await getStripe().accounts.del(account.id).catch(() => {});
        const fresh = await selectOne('revenue_partners', { id: `eq.${partner.id}` });
        accountId = fresh?.stripe_account_id;
        if (!accountId) return safeError('Could not start Stripe onboarding. Please try again.', 409);
      }
    }

    const origin = process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin;
    const link = await createOnboardingLink({
      accountId,
      refreshUrl: `${origin}/payouts?stripe=refresh`,
      returnUrl: `${origin}/payouts?stripe=done`,
    });

    return Response.json({ url: link, account_id: accountId });
  } catch (err) {
    console.error('stripe onboarding', err);
    return safeError(err.message || 'Could not start Stripe onboarding.', 502);
  }
}

/** Opens the partner's own Stripe Express dashboard. */
export async function PUT(request) {
  const { user, superAdmin, error } = await guard(request);
  if (error) return error;
  if (!stripeEnabled()) return safeError('Stripe payouts are not configured.', 503);

  try {
    const body = await request.json().catch(() => ({}));
    const partner = await resolvePartner(request, user, superAdmin, body.partner_id);
    if (!partner?.stripe_account_id) return safeError('Finish Stripe onboarding first.', 400);
    return Response.json({ url: await createDashboardLink(partner.stripe_account_id) });
  } catch (err) {
    console.error('stripe dashboard link', err);
    return safeError('Could not open the payouts dashboard.', 502);
  }
}

/**
 * Reset a Stripe connection, for when a partner signed in to the wrong Stripe
 * account, picked the wrong country, or onboarding got stuck.
 *
 * - A partner can reset their own connection until it has received money.
 * - A super admin can reset anyone's.
 * - Never while a payout is pending, so money cannot go to two places.
 * Earnings are not touched: they stay on the partner and are paid to the new
 * account once it is connected.
 */
export async function DELETE(request) {
  const { user, superAdmin, error } = await guard(request);
  if (error) return error;
  try {
    const body = await request.json().catch(() => ({}));
    const partner = await resolvePartner(request, user, superAdmin, body.partner_id);
    if (!partner) return safeError('You are not set up as a revenue partner.', 403);
    if (!partner.stripe_account_id) return Response.json({ ok: true, reset: false, message: 'Nothing to reset.' });

    const [pending, paid] = await Promise.all([
      selectRows('partner_payouts', { partner_id: `eq.${partner.id}`, status: 'eq.pending', limit: '1' }, 'id'),
      selectRows('partner_payouts', { partner_id: `eq.${partner.id}`, status: 'eq.paid', limit: '1' }, 'id'),
    ]);
    if (pending.length) {
      return safeError('A payout is still being processed. Reset once it has finished.', 409);
    }
    if (paid.length && !superAdmin) {
      return safeError('This Stripe account has already received payouts. Ask the super admin to reset it.', 403);
    }

    const oldAccount = partner.stripe_account_id;
    // Remove the unused Express account from Stripe when possible. Stripe
    // refuses if it ever held money, in which case it is simply unlinked.
    let removedFromStripe = false;
    if (stripeEnabled() && !paid.length) {
      removedFromStripe = await getStripe().accounts.del(oldAccount).then(() => true).catch(() => false);
    }

    const history = Array.isArray(partner.stripe_account_history) ? partner.stripe_account_history : [];
    const result = await updateRows(
      'revenue_partners',
      { id: `eq.${partner.id}`, stripe_account_id: `eq.${oldAccount}` },
      {
        stripe_account_id: null,
        payouts_enabled: false,
        onboarding_status: 'not_started',
        payout_country: null,
        stripe_account_history: [
          ...history,
          { account: oldAccount, reset_at: new Date().toISOString(), reset_by: superAdmin ? 'super_admin' : 'partner', removed_from_stripe: removedFromStripe },
        ],
        updated_at: new Date().toISOString(),
      }
    );
    if (!result.ok) return safeError('Could not reset the Stripe connection.', 500);
    await insertRows('user_admin_actions', {
      admin_user_id: user.id,
      action_type: 'reset_partner_stripe',
      new_value: { partner_id: partner.id, previous_account: oldAccount, removed_from_stripe: removedFromStripe },
      reason: body.reason ? String(body.reason).slice(0, 300) : null,
    }).catch(() => {});

    return Response.json({ ok: true, reset: true, removed_from_stripe: removedFromStripe });
  } catch (err) {
    console.error('stripe reset', err);
    return safeError('Could not reset the Stripe connection.', 500);
  }
}
