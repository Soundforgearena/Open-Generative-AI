import { requireSuperAdmin } from '@/lib/admin/authorize';
import { listAuthUsers, selectRows } from '@/lib/cinexvideo-server';

export const dynamic = 'force-dynamic';

const ACTION_LABEL = {
  set_maintenance: 'Site visibility changed',
  set_discount: 'Promotion changed',
  grant_bonus: 'Free credits granted',
  set_user_active: 'Account status changed',
  stripe_connection_reset: 'Stripe connection reset',
  set_payment_mode: 'Payment mode changed',
};

const money = (cents) => `$${(Number(cents || 0) / 100).toFixed(2)}`;
const when = (value) => (value ? new Date(value).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '—');

async function safe(promise) {
  try {
    return await promise;
  } catch {
    return null;
  }
}

function describe(value) {
  if (value === null || value === undefined) return '—';
  if (typeof value !== 'object') return String(value);
  if ('enabled' in value) return value.enabled ? 'On' : 'Off';
  if ('active' in value) return value.active ? 'Active' : 'Suspended';
  if ('credits' in value) return `${Number(value.credits).toLocaleString()} credits`;
  if ('mode' in value) return value.mode;
  return Object.entries(value)
    .filter(([, v]) => v !== null && typeof v !== 'object')
    .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`)
    .join(', ') || '—';
}

function splitText(split) {
  if (!split) return '—';
  const parts = [];
  if (split.platform_percent !== undefined && split.platform_percent !== null) parts.push(`Platform ${split.platform_percent}%`);
  if (Array.isArray(split.partners)) {
    for (const p of split.partners.filter((x) => x.active !== false)) parts.push(`${p.email} ${Number(p.share_percent)}%`);
  }
  return parts.join(' · ') || describe(split);
}

/** Super admin only: who changed what, and every payout. */
export default async function AdminAuditLogPage() {
  await requireSuperAdmin('/admin/audit-log');

  const [actions, splits, payouts, partners, auth] = await Promise.all([
    safe(selectRows('user_admin_actions', { order: 'created_at.desc', limit: 100 }, 'id,admin_user_id,target_user_id,action_type,old_value,new_value,reason,created_at')),
    safe(selectRows('revenue_split_audit', { order: 'created_at.desc', limit: 50 }, 'id,changed_by,old_split,new_split,reason,created_at')),
    safe(selectRows('partner_payouts', { order: 'created_at.desc', limit: 100 }, 'id,partner_id,amount_cents,provider,status,provider_transfer_id,created_at,completed_at')),
    safe(selectRows('revenue_partners', {}, 'id,display_name,email')),
    safe(listAuthUsers()),
  ]);

  const emailOf = (id) => (id ? auth?.get(id)?.email || `${String(id).slice(0, 8)}…` : 'System');
  const partnerOf = Object.fromEntries((partners || []).map((p) => [p.id, p.display_name || p.email]));

  return (
    <div className="cinex-admin-overview">
      <h1>Audit log</h1>
      <p className="cinex-route-description">Every admin action, revenue split change and partner payout, newest first. Super admin only.</p>

      <section className="cinex-admin-panel" aria-labelledby="audit-actions">
        <div className="cinex-admin-panel-head"><div><h2 id="audit-actions">Admin actions</h2></div></div>
        {actions === null ? (
          <p className="cinex-admin-note is-bad">Admin actions could not be read right now.</p>
        ) : actions.length ? (
          <div className="cinex-admin-table-wrap">
            <table className="cinex-admin-table">
              <thead><tr><th scope="col">When</th><th scope="col">By</th><th scope="col">Action</th><th scope="col">Account</th><th scope="col">Change</th><th scope="col">Reason</th></tr></thead>
              <tbody>
                {actions.map((a) => (
                  <tr key={a.id}>
                    <td>{when(a.created_at)}</td>
                    <td className="cinex-admin-cell-wrap">{emailOf(a.admin_user_id)}</td>
                    <td>{ACTION_LABEL[a.action_type] || a.action_type.replace(/_/g, ' ')}</td>
                    <td className="cinex-admin-cell-wrap">{a.target_user_id ? emailOf(a.target_user_id) : '—'}</td>
                    <td className="cinex-admin-cell-wrap">{describe(a.old_value)} → {describe(a.new_value)}</td>
                    <td className="cinex-admin-cell-wrap">{a.reason || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="cinex-admin-note">No admin actions recorded yet.</p>
        )}
      </section>

      <section className="cinex-admin-panel" aria-labelledby="audit-splits">
        <div className="cinex-admin-panel-head"><div><h2 id="audit-splits">Revenue split changes</h2></div></div>
        {splits === null ? (
          <p className="cinex-admin-note is-bad">Split history could not be read right now.</p>
        ) : splits.length ? (
          <div className="cinex-admin-table-wrap">
            <table className="cinex-admin-table">
              <thead><tr><th scope="col">When</th><th scope="col">By</th><th scope="col">Before</th><th scope="col">After</th><th scope="col">Reason</th></tr></thead>
              <tbody>
                {splits.map((s) => (
                  <tr key={s.id}>
                    <td>{when(s.created_at)}</td>
                    <td className="cinex-admin-cell-wrap">{emailOf(s.changed_by)}</td>
                    <td className="cinex-admin-cell-wrap">{splitText(s.old_split)}</td>
                    <td className="cinex-admin-cell-wrap">{splitText(s.new_split)}</td>
                    <td className="cinex-admin-cell-wrap">{s.reason || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="cinex-admin-note">No split changes recorded yet.</p>
        )}
      </section>

      <section className="cinex-admin-panel" aria-labelledby="audit-payouts">
        <div className="cinex-admin-panel-head"><div><h2 id="audit-payouts">Partner payouts</h2></div></div>
        {payouts === null ? (
          <p className="cinex-admin-note is-bad">Payouts could not be read right now.</p>
        ) : payouts.length ? (
          <div className="cinex-admin-table-wrap">
            <table className="cinex-admin-table">
              <thead><tr><th scope="col">Opened</th><th scope="col">Partner</th><th scope="col">Amount</th><th scope="col">Method</th><th scope="col">Status</th><th scope="col">Stripe transfer</th><th scope="col">Settled</th></tr></thead>
              <tbody>
                {payouts.map((p) => (
                  <tr key={p.id}>
                    <td>{when(p.created_at)}</td>
                    <td>{partnerOf[p.partner_id] || '—'}</td>
                    <td>{money(p.amount_cents)}</td>
                    <td>{p.provider === 'stripe_express' ? 'Stripe' : 'Manual'}</td>
                    <td>{p.status.replace(/_/g, ' ')}</td>
                    <td><code>{p.provider_transfer_id || '—'}</code></td>
                    <td>{when(p.completed_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="cinex-admin-note">No payouts yet.</p>
        )}
      </section>
    </div>
  );
}
