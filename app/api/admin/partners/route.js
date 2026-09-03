import { guard, selectRows, updateRows, callRpcAsUser, bearerToken, safeError } from '../../../../lib/cinexvideo-server';
import { stripeEnabled, getAccount, summariseAccount } from '../../../../lib/stripe-connect';

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
      config: config[0]?.value || { platform_percent: 50, basis: 'net' },
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
  const { error } = await guard(request, { requireSuperAdmin: true });
  if (error) return error;
  try {
    const body = await request.json();
    const token = bearerToken(request);

    if (body.config) {
      const percent = Number(body.config.platform_percent);
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
        return safeError('Platform share must be between 0 and 100.');
      }
      if (!['net', 'gross'].includes(body.config.basis)) {
        return safeError('Split basis must be net or gross.');
      }
      await callRpcAsUser(
        'admin_set_revenue_split',
        { p_platform_percent: percent, p_basis: body.config.basis },
        token
      );
    }

    if (Array.isArray(body.partners)) {
      const total = body.partners.reduce((sum, item) => sum + Number(item.share_percent || 0), 0);
      // Shares are a division of the partner pool, so they have to account for
      // all of it — otherwise the unallocated remainder silently disappears.
      if (Math.abs(total - 100) > 0.01) {
        return safeError(`Partner shares must total 100%. They currently total ${total}%.`);
      }
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

    return Response.json({ ok: true });
  } catch (err) {
    console.error('admin partners patch', err);
    return safeError('Could not update the revenue split.', 500);
  }
}
