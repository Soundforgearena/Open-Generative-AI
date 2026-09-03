'use client';

import { useCallback, useEffect, useState } from 'react';
import { getAdminSummary, getAdminUsers, runAdminAction } from '@/lib/cinexvideo-client';

function centsToMoney(cents) {
  return `$${(Number(cents || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
}

/**
 * Admin-only cockpit. Provider cost, revenue and the realised margin appear
 * here because the endpoint behind it is gated to admin_members.
 */
export default function AdminCockpit({ notify }) {
  const [summary, setSummary] = useState(null);
  const [users, setUsers] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [bonus, setBonus] = useState({ user_id: '', credits: 100, note: '' });
  const [discountPercent, setDiscountPercent] = useState(10);

  const load = useCallback(async () => {
    setError('');
    try {
      const [summaryData, userData] = await Promise.all([getAdminSummary(), getAdminUsers()]);
      setSummary(summaryData);
      setUsers(userData.users || []);
      setDiscountPercent(summaryData.controls.discount_percent ?? 10);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, [load]);

  async function act(payload, successMessage) {
    setBusy(true);
    try {
      await runAdminAction(payload);
      notify(successMessage);
      await load();
    } catch (err) {
      notify(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (error) return <div className="panel"><p className="auth-error">{error}</p></div>;
  if (!summary) return <div className="panel"><p>Loading cockpit…</p></div>;

  const { metrics, controls, health, recent_events: events } = summary;

  return (
    <div className="cockpit">
      <div className="metric-grid">
        {[
          ['Generations 24h', metrics.generations_24h],
          ['Failures 24h', metrics.failures_24h],
          ['Credits used 24h', metrics.credits_24h],
          ['Revenue 24h', centsToMoney(metrics.revenue_24h_cents)],
          ['Provider cost 24h', centsToMoney(metrics.provider_cost_24h_cents)],
          ['Users', metrics.total_users],
          ['Credits outstanding', metrics.credits_outstanding],
          ['Generations all time', metrics.generations_total],
        ].map(([label, value]) => (
          <div key={label} className="metric-card">
            <span className="eyebrow">{label}</span>
            <strong>{value}</strong>
          </div>
        ))}

        <div className={`metric-card ${metrics.margin_floor_met === false ? 'metric-alert' : ''}`}>
          <span className="eyebrow">Realised margin</span>
          <strong>
            {metrics.realised_margin_percent === null ? '—' : `${metrics.realised_margin_percent}%`}
          </strong>
          <small>
            Floor {metrics.margin_floor_percent}%
            {metrics.margin_floor_met === false ? ' · below floor' : ''}
          </small>
        </div>
      </div>

      <div className="panel">
        <div className="panel-heading">
          <span className="eyebrow">SERVICE CONTROLS</span>
          <button className="small-action" onClick={load} disabled={busy}>Refresh</button>
        </div>
        <div className="admin-strip">
          <button
            className={controls.maintenance_enabled ? 'control danger' : 'control'}
            disabled={busy}
            onClick={() =>
              act(
                { action: 'set_maintenance', enabled: !controls.maintenance_enabled },
                `Maintenance mode ${controls.maintenance_enabled ? 'disabled' : 'enabled'}`
              )
            }
          >
            Maintenance {controls.maintenance_enabled ? 'ON' : 'OFF'}
          </button>

          <button
            className={controls.discount_enabled ? 'control active-control' : 'control'}
            disabled={busy}
            onClick={() =>
              act(
                {
                  action: 'set_discount',
                  enabled: !controls.discount_enabled,
                  percent: Number(discountPercent) || 0,
                },
                `Promotion ${controls.discount_enabled ? 'disabled' : 'enabled'}`
              )
            }
          >
            Promotion {controls.discount_enabled ? `ON · ${controls.discount_percent}%` : 'OFF'}
          </button>

          <label className="inline-field">
            Percent
            <input
              type="number"
              min="0"
              max="100"
              value={discountPercent}
              onChange={(event) => setDiscountPercent(event.target.value)}
            />
          </label>
        </div>
        <p className="fine-print">
          The profitability floor is enforced in the pricing function, so a promotion can never
          price a generation below the internal minimum.
        </p>
      </div>

      <div className="panel">
        <span className="eyebrow">GRANT BONUS CREDITS</span>
        <div className="admin-strip">
          <label className="inline-field">
            User id
            <input
              value={bonus.user_id}
              placeholder="uuid"
              onChange={(event) => setBonus({ ...bonus, user_id: event.target.value })}
            />
          </label>
          <label className="inline-field">
            Credits
            <input
              type="number"
              min="1"
              value={bonus.credits}
              onChange={(event) => setBonus({ ...bonus, credits: event.target.value })}
            />
          </label>
          <label className="inline-field">
            Note
            <input
              value={bonus.note}
              onChange={(event) => setBonus({ ...bonus, note: event.target.value })}
            />
          </label>
          <button
            className="control"
            disabled={busy || !bonus.user_id}
            onClick={() =>
              act(
                {
                  action: 'grant_bonus',
                  user_id: bonus.user_id.trim(),
                  credits: Number(bonus.credits),
                  note: bonus.note || null,
                },
                'Bonus credits granted'
              )
            }
          >
            Grant
          </button>
        </div>
      </div>

      <div className="panel">
        <span className="eyebrow">USERS</span>
        <div className="table-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Balance</th>
                <th>Purchased</th>
                <th>Consumed</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.user_id}>
                  <td className="mono">
                    {user.user_id.slice(0, 8)}…{user.is_admin ? ' · admin' : ''}
                  </td>
                  <td>{user.balance}</td>
                  <td>{user.lifetime_purchased}</td>
                  <td>{user.lifetime_consumed}</td>
                  <td>{user.active ? 'Active' : 'Suspended'}</td>
                  <td>
                    <button
                      className="small-action"
                      disabled={busy}
                      onClick={() =>
                        act(
                          { action: 'set_user_active', user_id: user.user_id, active: !user.active },
                          user.active ? 'User suspended' : 'User reactivated'
                        )
                      }
                    >
                      {user.active ? 'Suspend' : 'Reactivate'}
                    </button>
                  </td>
                </tr>
              ))}
              {!users.length && (
                <tr>
                  <td colSpan={6}>No accounts yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="cockpit-split">
        <div className="panel">
          <span className="eyebrow">SERVICE HEALTH</span>
          <div className="status-items">
            {health.length ? (
              health.map((entry, index) => (
                <span key={`${entry.service}-${index}`}>
                  <span className={`status-dot ${entry.status === 'ok' ? 'green' : 'orange'}`} />{' '}
                  {entry.service} · {entry.status}
                  {entry.latency_ms ? ` · ${entry.latency_ms}ms` : ''}
                </span>
              ))
            ) : (
              <span>No health snapshots recorded yet.</span>
            )}
          </div>
        </div>

        <div className="panel">
          <span className="eyebrow">RECENT ACTIVITY</span>
          <div className="status-items">
            {events.length ? (
              events.slice(0, 10).map((event, index) => (
                <span key={index}>
                  {event.event_type} · {event.model || event.operation || '—'} ·{' '}
                  {event.credits ?? 0} credits · {event.status}
                </span>
              ))
            ) : (
              <span>No activity recorded yet.</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
