import { guard, selectRows, updateRows, insertRows, callRpcAsUser, bearerToken, safeError } from '../../../../lib/cinexvideo-server';
import { stripeEnabled, getAccount, summariseAccount } from '../../../../lib/stripe-connect';
import { validateSplit } from '../../../../lib/billing/revenue-split.js';

/** Revenue partners, their live balances, and the current split configuration. */
export async function GET(request) {
  const { error } = await guard(request, { requireSuperAdmin: true });
  if (error) return error;
  try {
    const [balances, config, recent] = await Promise.all([
      selectRows('partner_balances', { order: 'share_percent.desc' }),
      selectRows('app_settings', { key: 'eq.revenue_split' }, 'value'),
      selectRows(
        'revenue_events',
        { order: 'created_at.desc', limit: '25' },
        'id,source,reference_id,gross_cents,net_cents,platform_cents,distributed_cents,created_at'
      ),
    ]);

    // Refresh Stripe onboarding state so the cockpit is never stale.
    if (stripeEnabled()) {
      await Promise.all(
        balances
          .filter((partner) => partner.payout_provider === 'stripe_express' && partner.stripe_account_id)
          .map(async (partner) => {
            try {
              const summary = summariseAccount(await getAccount(partner.stripe_account_id));
              Object.assign(partner, summary);
              await updateRows(
                'revenue_partners',
                { id: `eq.${partner.partner_id}` },
                { payouts_enabled: summary.payouts_enabled, onboarding_status: summary.onboarding_status }
              );
            } catch {
              /* a Stripe hiccup should not blank the whole cockpit */
            }
          })
      );
    }

    const totals = recent.reduce(
      (acc, row) => ({
        gross: acc.gross + row.gross_cents,
        net: acc.net + row.net_cents,
        platform: acc.platform + row.platform_cents,
        partners: acc.partners + row.distributed_cents,
      }),
      { gross: 0, net: 0, platform: 0, partners: 0 }
    );

    return Response.json({
      partners: balances,
      config: config[0]?.value || { platform_percent: 30, basis: 'net' },
      stripe_configured: stripeEnabled(),
      recent_events: recent,
      totals,
    });
  } catch (err) {
    console.error('admin partners', err);
    return safeError('Partner data is temporarily unavailable.', 500);
  }
}

/** Update the platform share, the split basis, or an individual partner share. */
export async function PATCH(request) {
  const { user, error } = await guard(request, { requireSuperAdmin: true });
  if (error) return error;
  try {
    const body = await request.json();
    const token = bearerToken(request);

    // Validate everything before writing anything, so a bad edit can never
    // leave the platform share and the partner shares out of step.
    if (body.config) {
      const percent = Number(body.config.platform_percent);
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
        return safeError('Platform share must be between 0 and 100.');
      }
      if (body.config.basis !== 'net') {
        return safeError('Splits are always paid from net revenue (after provider costs and fees).');
      }
    }
    if (body.config || Array.isArray(body.partners)) {
      const current = await selectRows('app_settings', { key: 'eq.revenue_split' }, 'value');
      const platformPercent = body.config ? Number(body.config.platform_percent) : Number(current[0]?.value?.platform_percent ?? 30);
      const partners = Array.isArray(body.partners)
        ? body.partners
        : (await selectRows('revenue_partners', { active: 'eq.true' }, 'share_percent,active'));
      const check = validateSplit({ platformPercent, partners });
      if (!check.ok) return safeError(check.error);
    }

    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 200) || null : null;
    const before = await selectRows('revenue_partners', { order: 'share_percent.desc' }, 'id,email,share_percent,active');

    if (body.config) {
      const result = await callRpcAsUser(
        'admin_set_revenue_split',
        { p_platform_percent: Number(body.config.platform_percent), p_basis: 'net', p_reason: reason },
        token
      );
      if (!result.ok) return safeError('The platform share could not be saved. Nothing else was changed.', 500);
    }

    if (Array.isArray(body.partners)) {
      for (const partner of body.partners) {
        await updateRows(
          'revenue_partners',
          { id: `eq.${partner.partner_id}` },
          {
            share_percent: Number(partner.share_percent),
            active: partner.active !== false,
            updated_at: new Date().toISOString(),
          }
        );
      }
    }

    if (Array.isArray(body.partners)) {
      const after = await selectRows('revenue_partners', { order: 'share_percent.desc' }, 'id,email,share_percent,active');
      await insertRows('revenue_split_audit', {
        changed_by: user.id,
        old_split: { partners: before },
        new_split: { partners: after, platform_percent: body.config ? Number(body.config.platform_percent) : null, basis: 'net' },
        reason,
      }).catch(() => null);
    }

    return Response.json({ ok: true });
  } catch (err) {
    console.error('admin partners patch', err);
    return safeError('Could not update the revenue split.', 500);
  }
}
