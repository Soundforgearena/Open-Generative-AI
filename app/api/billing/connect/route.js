import { guard, selectOne, updateRows, safeError } from '../../../../lib/cinexvideo-server';
import {
  stripeEnabled,
  createExpressAccount,
  createOnboardingLink,
} from '../../../../lib/stripe-connect';

/**
 * Legacy Stripe Express onboarding endpoint.
 *
 * Kept for older clients that post { partnerId, email } and expect
 * { accountId, onboardingUrl } back. /api/partners/connect is the canonical
 * route; this one shares the same bearer-token auth so both agree on who the
 * caller is.
 */
export const dynamic = 'force-dynamic';

export async function POST(request) {
  const { user, superAdmin, error } = await guard(request);
  if (error) return error;

  if (!stripeEnabled()) {
    return safeError('Stripe payouts are not configured on this deployment yet.', 503);
  }

  try {
    const body = await request.json().catch(() => ({}));
    const partnerId = body.partnerId || body.partner_id;

    // A super admin may onboard on behalf of a partner; everyone else may only
    // onboard themselves, regardless of the id they pass.
    const partner = partnerId && superAdmin
      ? await selectOne('revenue_partners', { id: `eq.${partnerId}` })
      : await selectOne('revenue_partners', { user_id: `eq.${user.id}` });

    if (!partner) return safeError('You are not set up as a revenue partner.', 403);

    if (partner.stripe_account_id) {
      return safeError('This partner already has a Stripe account.', 400);
    }

    const origin = process.env.NEXT_PUBLIC_SITE_URL
      || process.env.NEXT_PUBLIC_APP_URL
      || new URL(request.url).origin;

    const account = await createExpressAccount({
      email: partner.email || body.email,
      country: body.country || process.env.STRIPE_PARTNER_COUNTRY || 'US',
      businessUrl: origin,
      partnerId: partner.id,
      displayName: partner.display_name,
    });

    await updateRows(
      'revenue_partners',
      { id: `eq.${partner.id}` },
      {
        stripe_account_id: account.id,
        payout_provider: 'stripe_express',
        onboarding_status: 'action_required',
        updated_at: new Date().toISOString(),
      }
    );

    const onboardingUrl = await createOnboardingLink({
      accountId: account.id,
      refreshUrl: `${origin}/?payouts=refresh`,
      returnUrl: `${origin}/?payouts=done`,
    });

    return Response.json({ accountId: account.id, onboardingUrl, url: onboardingUrl });
  } catch (err) {
    console.error('stripe connect onboarding', err);
    return safeError('Could not start Stripe onboarding.', 502);
  }
}
