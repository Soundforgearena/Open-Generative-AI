import {
  guard,
  bearerToken,
  callRpcAsUser,
  selectRows,
  getSetting,
  forgetSetting,
  safeError,
  listAuthUsers,
} from '../../../../lib/cinexvideo-server';

/**
 * Admin control deck. Every action runs through the admin_* Supabase functions
 * using the admin's own token, so auth.uid() is real and each change is written
 * to user_admin_actions as an audit record.
 */
// Actions that cost the platform money (free credits, price cuts) are
// super admin only. Admins can moderate accounts and the site switch.
const SUPER_ADMIN_ACTIONS = new Set(['grant_bonus', 'set_discount']);

export async function POST(request) {
  const { user, superAdmin, error } = await guard(request, { requireAdminRole: true });
  if (error) return error;
  const token = bearerToken(request);

  try {
    const body = await request.json();
    const action = body.action;
    if (SUPER_ADMIN_ACTIONS.has(action) && !superAdmin) {
      return safeError('Only the super admin can do that.', 403);
    }

    if (action === 'set_maintenance') {
      const result = await callRpcAsUser(
        'admin_set_maintenance',
        { p_enabled: Boolean(body.enabled), p_message: body.message || null },
        token
      );
      if (!result.ok) return safeError('Maintenance mode could not be changed.', 500);
      forgetSetting('maintenance_mode');
      return Response.json({ maintenance_enabled: Boolean(body.enabled) });
    }

    if (action === 'set_discount') {
      const percent = Number(body.percent);
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
        return safeError('Discount must be between 0 and 100 percent.');
      }
      const result = await callRpcAsUser(
        'admin_set_discount',
        { p_enabled: Boolean(body.enabled), p_percent: percent, p_label: body.label || null },
        token
      );
      // quote_generation still enforces the profitability floor, so a discount
      // can never take a price below the internal minimum.
      if (!result.ok) return safeError('Discount could not be changed.', 500);
      forgetSetting('discount_mode');
      const discount = await getSetting('discount_mode');
      return Response.json({ discount });
    }

    if (action === 'grant_bonus') {
      const credits = Number(body.credits);
      if (!body.user_id) return safeError('A user id is required.');
      if (!Number.isInteger(credits) || credits <= 0) return safeError('Credits must be a whole number above zero.');
      if (credits > 10000) return safeError('Grant at most 10,000 credits ($100) at a time.');
      const result = await callRpcAsUser(
        'admin_grant_bonus',
        { p_target_user_id: body.user_id, p_credits: credits, p_note: body.note || null },
        token
      );
      if (!result.ok) return safeError('Bonus credits could not be granted.', 500);
      return Response.json({ granted: credits });
    }

    if (action === 'set_user_active') {
      if (!body.user_id) return safeError('A user id is required.');
      if (body.user_id === user.id) return safeError('You cannot suspend your own account.');
      const targetRole = await selectRows('admin_members', { user_id: `eq.${body.user_id}`, limit: 1 }, 'role');
      if (targetRole.length && !superAdmin) return safeError('Only the super admin can suspend another admin.', 403);
      if (targetRole[0]?.role === 'super_admin') return safeError('The super admin account cannot be suspended here.', 403);
      const result = await callRpcAsUser(
        'admin_set_user_active',
        {
          p_target_user_id: body.user_id,
          p_active: Boolean(body.active),
          p_reason: body.reason || null,
        },
        token
      );
      if (!result.ok) return safeError('User status could not be changed.', 500);
      return Response.json({ user_id: body.user_id, active: Boolean(body.active) });
    }

    return safeError('Unknown admin action.');
  } catch (err) {
    console.error('admin actions', err);
    return safeError('Admin action could not be completed.', 500);
  }
}

/** Roster for the user-management panel. */
export async function GET(request) {
  const { superAdmin, error } = await guard(request, { requireAdminRole: true });
  if (error) return error;

  try {
    const [wallets, statuses, admins, auth] = await Promise.all([
      selectRows('credit_wallets', { order: 'updated_at.desc', limit: 500 }, 'user_id,balance,lifetime_purchased,lifetime_consumed,updated_at'),
      selectRows('user_account_status', { limit: 1000 }, 'user_id,active,reason'),
      selectRows('admin_members', { limit: 200 }, 'user_id,role'),
      listAuthUsers().catch(() => new Map()),
    ]);
    const roleById = new Map(admins.map((row) => [row.user_id, row.role || 'admin']));
    const statusById = new Map(statuses.map((row) => [row.user_id, row]));
    const ids = new Set([...wallets.map((w) => w.user_id), ...auth.keys()]);
    const walletById = new Map(wallets.map((w) => [w.user_id, w]));

    const users = [...ids].map((id) => {
      const wallet = walletById.get(id) || {};
      const info = auth.get(id) || {};
      return {
        user_id: id,
        email: info.email || null,
        created_at: info.created_at || null,
        last_sign_in_at: info.last_sign_in_at || null,
        balance: Number(wallet.balance || 0),
        lifetime_purchased: Number(wallet.lifetime_purchased || 0),
        lifetime_consumed: Number(wallet.lifetime_consumed || 0),
        active: statusById.get(id)?.active ?? true,
        role: roleById.get(id) || 'member',
        is_admin: roleById.has(id),
      };
    }).sort((a, b) => String(b.last_sign_in_at || b.created_at || '').localeCompare(String(a.last_sign_in_at || a.created_at || '')));

    return Response.json({ users, viewer: { super_admin: Boolean(superAdmin) } });
  } catch (err) {
    console.error('admin users', err);
    return safeError('The user list is temporarily unavailable.', 500);
  }
}
