import {
  guard,
  bearerToken,
  callRpcAsUser,
  selectRows,
  getSetting,
  safeError,
} from '../../../../lib/cinexvideo-server';

/**
 * Admin control deck. Every action runs through the admin_* Supabase functions
 * using the admin's own token, so auth.uid() is real and each change is written
 * to user_admin_actions as an audit record.
 */
export async function POST(request) {
  const { error } = await guard(request, { requireAdminRole: true });
  if (error) return error;
  const token = bearerToken(request);

  try {
    const body = await request.json();
    const action = body.action;

    if (action === 'set_maintenance') {
      const result = await callRpcAsUser(
        'admin_set_maintenance',
        { p_enabled: Boolean(body.enabled), p_message: body.message || null },
        token
      );
      if (!result.ok) return safeError('Maintenance mode could not be changed.', 500);
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
      const discount = await getSetting('discount_mode');
      return Response.json({ discount });
    }

    if (action === 'grant_bonus') {
      const credits = Number(body.credits);
      if (!body.user_id) return safeError('A user id is required.');
      if (!Number.isFinite(credits) || credits <= 0) return safeError('Credits must be positive.');
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
  const { error } = await guard(request, { requireAdminRole: true });
  if (error) return error;

  const wallets = await selectRows(
    'credit_wallets',
    { order: 'updated_at.desc', limit: 200 },
    'user_id,balance,lifetime_purchased,lifetime_consumed,updated_at'
  );
  const statuses = await selectRows('user_account_status', { limit: 500 }, 'user_id,active,reason');
  const admins = await selectRows('admin_members', { limit: 200 }, 'user_id');
  const adminIds = new Set(admins.map((row) => row.user_id));

  return Response.json({
    users: wallets.map((wallet) => ({
      ...wallet,
      active: statuses.find((s) => s.user_id === wallet.user_id)?.active ?? true,
      is_admin: adminIds.has(wallet.user_id),
    })),
  });
}
