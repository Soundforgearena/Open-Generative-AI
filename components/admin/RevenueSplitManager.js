'use client';

import { useCallback, useEffect, useState } from 'react';
import { getPayouts, markPayout, sendPayout, updateRevenueSplit } from '@/lib/cinexvideo-client';

const money = (cents) =>
  `$${(Number(cents || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const PAYOUT_STATUS = {
  pending: ['Pending', 'is-warn'],
  needs_check: ['Check in Stripe', 'is-bad'],
  paid: ['Paid', 'is-ok'],
  failed: ['Failed', 'is-bad'],
  cancelled: ['Cancelled', 'is-muted'],
};

/** Minimum payout the monthly run sends, so small balances are not eaten by fees. */
const MINIMUM_PAYOUT_CENTS = 1000;

/**
 * Super admin only: edit the split of net revenue, send payouts and settle
 * manual ones. Every request behind it is gated to the super admin server-side.
 */
export default function RevenueSplitManager({ partners, config, totals, stripeConfigured, onChanged }) {
  const [platform, setPlatform] = useState(Number(config?.platform_percent ?? 30));
  const [shares, setShares] = useState({});
  const [reason, setReason] = useState('');
  const [payouts, setPayouts] = useState([]);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState(null);

  const active = partners.filter((p) => p.active !== false);

  useEffect(() => {
    setPlatform(Number(config?.platform_percent ?? 30));
    setShares(Object.fromEntries(partners.map((p) => [p.id, Number(p.share_percent || 0)])));
  }, [partners, config]);

  const loadPayouts = useCallback(async () => {
    try {
      const data = await getPayouts();
      setPayouts(data.payouts || []);
    } catch (err) {
      setNotice({ tone: 'is-bad', text: err.message || 'Payout history could not be loaded.' });
    }
  }, []);

  useEffect(() => {
    loadPayouts();
  }, [loadPayouts]);

  const partnerTotal = active.reduce((sum, p) => sum + Number(shares[p.id] || 0), 0);
  const total = Number(platform || 0) + partnerTotal;
  const balanced = Math.abs(total - 100) < 0.01;
  const changed =
    Number(platform) !== Number(config?.platform_percent ?? 30) ||
    active.some((p) => Number(shares[p.id]) !== Number(p.share_percent));

  async function run(key, fn, success) {
    setBusy(key);
    setNotice(null);
    try {
      const result = await fn();
      setNotice({ tone: 'is-ok', text: typeof success === 'function' ? success(result) : success });
      await Promise.all([loadPayouts(), onChanged?.()]);
    } catch (err) {
      setNotice({ tone: 'is-bad', text: err.message || 'That did not work. Nothing was changed.' });
    } finally {
      setBusy('');
    }
  }

  function saveSplit() {
    run(
      'split',
      () =>
        updateRevenueSplit({
          config: { platform_percent: Number(platform), basis: 'net' },
          partners: active.map((p) => ({ partner_id: p.id, share_percent: Number(shares[p.id] || 0) })),
          reason: reason || null,
        }),
      'Split saved. It applies to revenue from now on; earnings already recorded keep the split they were earned under.'
    );
  }

  function pay(partner) {
    const ready = stripeConfigured && partner.stripe_account_id && partner.payouts_enabled;
    const label = `${money(partner.available_cents)} to ${partner.display_name || partner.email}`;
    const how = ready ? 'through Stripe now' : 'as a manual payout you mark paid after sending it yourself';
    if (!window.confirm(`Pay ${label} ${how}?`)) return;
    run(
      `pay-${partner.id}`,
      () => sendPayout({ partner_id: partner.id, method: ready ? 'stripe' : 'manual' }),
      (result) => result?.message || `Payout of ${money(result?.amount_cents)} ${result?.status || 'opened'}.`
    );
  }

  function settle(payout, status) {
    const words = status === 'paid' ? 'Mark this payout as paid?' : 'Cancel this payout? The earnings go back to the partner\'s available balance.';
    if (!window.confirm(words)) return;
    run(`settle-${payout.id}`, () => markPayout(payout.id, status), status === 'paid' ? 'Marked as paid.' : 'Payout cancelled and earnings returned.');
  }

  return (
    <div className="cinex-admin-stack">
      <section className="cinex-admin-panel" aria-labelledby="split-editor-title">
        <div className="cinex-admin-panel-head">
          <div>
            <h2 id="split-editor-title">Edit the split</h2>
            <p>Shares of net revenue: what is left after AI costs, overhead and Stripe fees. Must total exactly 100%.</p>
          </div>
          <span className={`cinex-status-tag ${balanced ? 'is-ok' : 'is-bad'}`}>Total {Number(total.toFixed(2))}%</span>
        </div>

        <div className="cinex-split-editor">
          <label className="cinex-admin-field is-platform">
            <span>Platform keeps</span>
            <span className="cinex-admin-input-suffix">
              <input type="number" inputMode="decimal" min="0" max="100" step="0.5" value={platform} onChange={(e) => setPlatform(e.target.value)} />
              <em>%</em>
            </span>
          </label>
          {active.map((p) => (
            <label key={p.id} className="cinex-admin-field">
              <span title={p.email}>{p.display_name || p.email}</span>
              <span className="cinex-admin-input-suffix">
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  max="100"
                  step="0.5"
                  value={shares[p.id] ?? 0}
                  onChange={(e) => setShares({ ...shares, [p.id]: e.target.value })}
                />
                <em>%</em>
              </span>
            </label>
          ))}
        </div>

        <div className="cinex-admin-toolbar">
          <label className="cinex-admin-field is-wide">
            <span>Reason (kept in the audit log)</span>
            <input value={reason} maxLength={200} placeholder="e.g. Partner agreement amendment" onChange={(e) => setReason(e.target.value)} />
          </label>
          <button type="button" className="cinex-admin-btn is-primary" disabled={!balanced || !changed || busy === 'split'} onClick={saveSplit}>
            {busy === 'split' ? 'Saving...' : 'Save split'}
          </button>
        </div>
        {!balanced && <p className="cinex-admin-note is-bad">The platform and partners add up to {Number(total.toFixed(2))}%. Adjust until it is exactly 100%.</p>}
      </section>

      <section className="cinex-admin-panel" aria-labelledby="payouts-title">
        <div className="cinex-admin-panel-head">
          <div>
            <h2 id="payouts-title">Payouts</h2>
            <p>
              Balances of {money(MINIMUM_PAYOUT_CENTS)} or more are paid automatically each month to partners whose Stripe is connected.
              You can also pay a partner now.
            </p>
          </div>
          {totals && (
            <span className="cinex-status-tag is-muted">Last 25 sales: {money(totals.net)} net, {money(totals.partners)} to partners</span>
          )}
        </div>

        <div className="cinex-admin-table-wrap">
          <table className="cinex-admin-table">
            <thead>
              <tr>
                <th scope="col">Partner</th>
                <th scope="col">Share</th>
                <th scope="col">Ready to pay</th>
                <th scope="col">Pending</th>
                <th scope="col">Paid out</th>
                <th scope="col">Stripe</th>
                <th scope="col"><span className="cinex-sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {partners.map((p) => {
                const ready = stripeConfigured && p.stripe_account_id && p.payouts_enabled;
                return (
                  <tr key={p.id}>
                    <td>{p.display_name || p.email}{p.active === false ? ' (inactive)' : ''}</td>
                    <td>{Number(p.share_percent)}%</td>
                    <td>{money(p.available_cents)}</td>
                    <td>{money(p.pending_payout_cents)}</td>
                    <td>{money(p.paid_out_cents)}</td>
                    <td>
                      <span className={`cinex-status-tag ${ready ? 'is-ok' : 'is-warn'}`}>
                        {ready ? 'Ready' : p.stripe_account_id ? 'Setup incomplete' : 'Not connected'}
                      </span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="cinex-admin-btn"
                        disabled={!Number(p.available_cents) || Number(p.pending_payout_cents) > 0 || busy === `pay-${p.id}`}
                        onClick={() => pay(p)}
                      >
                        {busy === `pay-${p.id}` ? 'Paying...' : ready ? 'Pay now' : 'Pay manually'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <h3 className="cinex-admin-subhead">Payout history</h3>
        {payouts.length ? (
          <div className="cinex-admin-table-wrap">
            <table className="cinex-admin-table">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Partner</th>
                  <th scope="col">Amount</th>
                  <th scope="col">Method</th>
                  <th scope="col">Status</th>
                  <th scope="col"><span className="cinex-sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {payouts.map((payout) => {
                  const [label, tone] = PAYOUT_STATUS[payout.status] || [payout.status, 'is-muted'];
                  const open = payout.status === 'pending' || payout.status === 'needs_check';
                  return (
                    <tr key={payout.id}>
                      <td>{new Date(payout.created_at).toLocaleDateString()}</td>
                      <td>{payout.partner?.display_name || payout.partner?.email || '—'}</td>
                      <td>{money(payout.amount_cents)}</td>
                      <td>{payout.provider === 'stripe_express' ? 'Stripe' : 'Manual'}</td>
                      <td><span className={`cinex-status-tag ${tone}`}>{label}</span></td>
                      <td>
                        {open && (
                          <span className="cinex-admin-row-actions">
                            <button type="button" className="cinex-admin-btn" disabled={busy === `settle-${payout.id}`} onClick={() => settle(payout, 'paid')}>Mark paid</button>
                            <button type="button" className="cinex-admin-btn is-danger" disabled={busy === `settle-${payout.id}`} onClick={() => settle(payout, 'cancelled')}>Cancel</button>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="cinex-admin-note">No payouts yet.</p>
        )}
        {payouts.some((p) => p.status === 'needs_check') && (
          <p className="cinex-admin-note is-bad">
            A payout marked &ldquo;Check in Stripe&rdquo; got no clear answer from Stripe. Look it up in your Stripe dashboard (Connect → Transfers) before marking it paid or cancelling, so nobody is paid twice.
          </p>
        )}
      </section>

      {notice && <p className={`cinex-admin-note ${notice.tone}`} role="status">{notice.text}</p>}
    </div>
  );
}
