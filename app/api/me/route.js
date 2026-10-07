import { guard, callRpc, selectOne, getSetting, safeError } from '../../../lib/cinexvideo-server';
import { isAtCostUser } from '../../../lib/billing/at-cost.js';

/** Session bootstrap: identity, credit balance, admin role, service banner. */
export async function GET(request) {
  const { user, admin, superAdmin, error } = await guard(request);
  if (error) return error;
  try {
    await callRpc('get_or_create_credit_wallet', { p_user_id: user.id });
    const wallet = await selectOne('credit_wallets', { user_id: `eq.${user.id}` }, 'balance');
    const maintenance = await getSetting('maintenance_mode');
    const discount = await getSetting('discount_mode');
    const partner = await selectOne(
      'revenue_partners',
      { user_id: `eq.${user.id}` },
      'id,display_name,share_percent,payouts_enabled,onboarding_status'
    );

    return Response.json({
      user: { id: user.id, email: user.email },
      is_admin: admin,
      is_super_admin: superAdmin,
      role: superAdmin ? 'super_admin' : admin ? 'admin' : 'member',
      // Each partner sees only their own share and payout status. The full
      // split (everyone's shares) is available to the super admin only.
      partner: partner
        ? {
            id: partner.id,
            display_name: partner.display_name,
            share_percent: Number(partner.share_percent),
            payouts_enabled: partner.payouts_enabled,
            onboarding_status: partner.onboarding_status,
          }
        : null,
      credits: wallet?.balance ?? 0,
      // Super admins pay cost (no markup) from purchased credits.
      at_cost: isAtCostUser({ superAdmin }),
      maintenance: Boolean(maintenance?.enabled),
      // Customers see only that a promotion is running, never the maths behind it.
      promotion_active: Boolean(discount?.enabled),
    });
  } catch (err) {
    console.error('me route', err);
    return safeError('Account details are temporarily unavailable.', 500);
  }
}
