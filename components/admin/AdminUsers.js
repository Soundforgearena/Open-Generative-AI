'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getAdminUsers, runAdminAction } from '@/lib/cinexvideo-client';

const number = (value) => Number(value || 0).toLocaleString();
const ROLE_LABEL = { super_admin: 'Super admin', admin: 'Admin', member: 'Member' };
const shortDate = (value) => (value ? new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—');

/**
 * User management. Admins can find accounts and suspend/reactivate members;
 * granting free credits costs real money, so it is super admin only (also
 * enforced server-side).
 */
export default function AdminUsers() {
  const [users, setUsers] = useState([]);
  const [isSuper, setIsSuper] = useState(false);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState(null);
  const [grant, setGrant] = useState({ user_id: '', credits: 100, note: '' });

  const load = useCallback(async () => {
    try {
      const data = await getAdminUsers();
      setUsers(data.users || []);
      setIsSuper(Boolean(data.viewer?.super_admin));
    } catch (err) {
      setNotice({ tone: 'is-bad', text: err.message || 'The user list could not be loaded.' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => (u.email || '').toLowerCase().includes(q) || u.user_id.startsWith(q));
  }, [users, query]);

  const totals = useMemo(
    () => ({
      accounts: users.length,
      suspended: users.filter((u) => !u.active).length,
      outstanding: users.reduce((sum, u) => sum + Number(u.balance || 0), 0),
    }),
    [users]
  );

  async function act(key, payload, success) {
    setBusy(key);
    setNotice(null);
    try {
      await runAdminAction(payload);
      setNotice({ tone: 'is-ok', text: success });
      await load();
    } catch (err) {
      setNotice({ tone: 'is-bad', text: err.message || 'That did not work. Nothing was changed.' });
    } finally {
      setBusy('');
    }
  }

  function toggle(user) {
    const verb = user.active ? 'Suspend' : 'Reactivate';
    if (!window.confirm(`${verb} ${user.email || user.user_id}?`)) return;
    act(`user-${user.user_id}`, { action: 'set_user_active', user_id: user.user_id, active: !user.active }, user.active ? 'Account suspended.' : 'Account reactivated.');
  }

  function grantCredits(event) {
    event.preventDefault();
    const credits = Math.round(Number(grant.credits));
    const target = users.find((u) => u.user_id === grant.user_id);
    if (!target) return;
    if (!window.confirm(`Give ${number(credits)} free credits ($${(credits / 100).toFixed(2)} of usage the platform pays for) to ${target.email || target.user_id}?`)) return;
    act('grant', { action: 'grant_bonus', user_id: target.user_id, credits, note: grant.note || null }, `${number(credits)} credits granted.`).then(() =>
      setGrant({ user_id: '', credits: 100, note: '' })
    );
  }

  if (loading) return <p className="cinex-route-description">Loading accounts...</p>;

  return (
    <div className="cinex-admin-stack">
      <div className="cinex-admin-kpis">
        <article className="cinex-admin-kpi"><span>Accounts</span><strong>{number(totals.accounts)}</strong></article>
        <article className="cinex-admin-kpi"><span>Suspended</span><strong>{number(totals.suspended)}</strong></article>
        <article className="cinex-admin-kpi"><span>Credits outstanding</span><strong>{number(totals.outstanding)}</strong><small>${(totals.outstanding / 100).toFixed(2)} of prepaid usage owed</small></article>
      </div>

      {isSuper && (
        <form className="cinex-admin-panel" onSubmit={grantCredits} aria-labelledby="grant-title">
          <div className="cinex-admin-panel-head">
            <div>
              <h2 id="grant-title">Give free credits</h2>
              <p>Super admin only. Free credits are paid for by the platform at cost when they are used, so keep grants small.</p>
            </div>
          </div>
          <div className="cinex-admin-toolbar">
            <label className="cinex-admin-field is-wide">
              <span>Account</span>
              <select value={grant.user_id} onChange={(e) => setGrant({ ...grant, user_id: e.target.value })} required>
                <option value="">Choose an account</option>
                {users.map((u) => <option key={u.user_id} value={u.user_id}>{u.email || u.user_id}</option>)}
              </select>
            </label>
            <label className="cinex-admin-field">
              <span>Credits</span>
              <input type="number" inputMode="numeric" min="1" max="10000" step="1" value={grant.credits} onChange={(e) => setGrant({ ...grant, credits: e.target.value })} required />
            </label>
            <label className="cinex-admin-field is-wide">
              <span>Note</span>
              <input value={grant.note} maxLength={140} placeholder="Why (kept in the audit log)" onChange={(e) => setGrant({ ...grant, note: e.target.value })} />
            </label>
            <button type="submit" className="cinex-admin-btn is-primary" disabled={!grant.user_id || busy === 'grant'}>
              {busy === 'grant' ? 'Granting...' : 'Grant credits'}
            </button>
          </div>
        </form>
      )}

      <section className="cinex-admin-panel" aria-labelledby="users-title">
        <div className="cinex-admin-panel-head">
          <div>
            <h2 id="users-title">Accounts</h2>
            <p>Suspended accounts cannot sign in to create, generate or buy.</p>
          </div>
          <label className="cinex-admin-field cinex-admin-search">
            <span className="cinex-sr-only">Search accounts</span>
            <input type="search" placeholder="Search by email" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
        </div>
        <div className="cinex-admin-table-wrap">
          <table className="cinex-admin-table">
            <thead>
              <tr>
                <th scope="col">Account</th>
                <th scope="col">Role</th>
                <th scope="col">Credits</th>
                <th scope="col">Bought</th>
                <th scope="col">Used</th>
                <th scope="col">Last sign-in</th>
                <th scope="col">Status</th>
                <th scope="col"><span className="cinex-sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => {
                const canToggle = u.role === 'member' || (isSuper && u.role === 'admin');
                return (
                  <tr key={u.user_id}>
                    <td className="cinex-admin-cell-wrap">{u.email || <code>{u.user_id.slice(0, 8)}…</code>}</td>
                    <td>{ROLE_LABEL[u.role] || u.role}</td>
                    <td>{number(u.balance)}</td>
                    <td>{number(u.lifetime_purchased)}</td>
                    <td>{number(u.lifetime_consumed)}</td>
                    <td>{shortDate(u.last_sign_in_at)}</td>
                    <td><span className={`cinex-status-tag ${u.active ? 'is-ok' : 'is-bad'}`}>{u.active ? 'Active' : 'Suspended'}</span></td>
                    <td>
                      {canToggle && (
                        <button type="button" className={`cinex-admin-btn ${u.active ? 'is-danger' : ''}`} disabled={busy === `user-${u.user_id}`} onClick={() => toggle(u)}>
                          {u.active ? 'Suspend' : 'Reactivate'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!filtered.length && (
                <tr><td colSpan={8}>{query ? 'No accounts match that search.' : 'No accounts yet.'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {notice && <p className={`cinex-admin-note ${notice.tone}`} role="status">{notice.text}</p>}
    </div>
  );
}
