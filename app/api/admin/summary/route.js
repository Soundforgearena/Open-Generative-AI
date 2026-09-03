import { guard, selectRows, selectOne, getSetting, safeError } from '../../../../lib/cinexvideo-server';

/**
 * Admin cockpit data. Margin, provider cost and revenue are returned here and
 * only here — this route is hard-gated to admin_members.
 */
export async function GET(request) {
  const { error } = await guard(request, { requireAdminRole: true });
  if (error) return error;

  try {
    const summary = (await selectOne('admin_cockpit_summary', {})) || {};
    const revenue = Number(summary.revenue_24h_cents || 0);
    const providerCost = Number(summary.provider_cost_24h_cents || 0);
    const marginPercent = revenue > 0 ? ((revenue - providerCost) / revenue) * 100 : null;

    const [maintenance, discount] = await Promise.all([
      getSetting('maintenance_mode'),
      getSetting('discount_mode'),
    ]);

    const health = await selectRows(
      'admin_health_snapshots',
      { order: 'checked_at.desc', limit: 12 },
      'service,status,latency_ms,error_rate,checked_at'
    );

    const recentEvents = await selectRows(
      'admin_metric_events',
      { order: 'created_at.desc', limit: 25 },
      'event_type,operation,model,credits,status,created_at'
    );

    const wallets = await selectRows('credit_wallets', { limit: 1000 }, 'balance,lifetime_consumed');
    const generations = await selectRows('generation_requests', { limit: 1000 }, 'status');

    return Response.json({
      metrics: {
        generations_24h: Number(summary.generations_24h || 0),
        failures_24h: Number(summary.failures_24h || 0),
        credits_24h: Number(summary.credits_24h || 0),
        revenue_24h_cents: revenue,
        provider_cost_24h_cents: providerCost,
        realised_margin_percent: marginPercent === null ? null : Number(marginPercent.toFixed(1)),
        margin_floor_percent: 45,
        margin_floor_met: marginPercent === null ? null : marginPercent >= 45,
        total_users: wallets.length,
        credits_outstanding: wallets.reduce((sum, w) => sum + Number(w.balance || 0), 0),
        generations_total: generations.length,
        generations_failed_total: generations.filter((g) => g.status === 'released' || g.status === 'failed').length,
      },
      controls: {
        maintenance_enabled: Boolean(maintenance?.enabled),
        maintenance_message: maintenance?.message || null,
        discount_enabled: Boolean(discount?.enabled),
        discount_percent: discount?.percent ?? null,
      },
      health,
      recent_events: recentEvents,
    });
  } catch (err) {
    console.error('admin summary', err);
    return safeError('Cockpit data is temporarily unavailable.', 500);
  }
}
