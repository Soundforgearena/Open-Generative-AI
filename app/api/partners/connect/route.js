import { guard, selectOne, updateRows, safeError } from '../../../../lib/cinexvideo-server';
import {
  stripeEnabled,
  createExpressAccount,
  createOnboardingLink,
  createDashboardLink,
  getAccount,
  summariseAccount,
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
    share_percent: partner.share_percent,
    payout_provider: partner.payout_provider,
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
      const account = await createExpressAccount({
        email: partner.email,
        country: body.country || process.env.STRIPE_PARTNER_COUNTRY || 'US',
        businessUrl: process.env.NEXT_PUBLIC_SITE_URL,
      });
      accountId = account.id;
      await updateRows(
        'revenue_partners',
        { id: `eq.${partner.id}` },
        {
          stripe_account_id: accountId,
          payout_provider: 'stripe_express',
          onboarding_status: 'action_required',
          updated_at: new Date().toISOString(),
        }
      );
    }

    const origin = process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin;
    const link = await createOnboardingLink({
      accountId,
      refreshUrl: `${origin}/?payouts=refresh`,
      returnUrl: `${origin}/?payouts=done`,
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
