'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  getPartners,
  getPayouts,
  markPayout,
  openStripeDashboard,
  sendPayout,
  startStripeOnboarding,
  updateRevenueSplit,
} from '@/lib/cinexvideo-client';

const money = (cents) =>
  `$${((cents || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const ONBOARDING_LABEL = {
  complete: 'Payouts enabled',
  under_review: 'Under review by Stripe',
  action_required: 'Onboarding incomplete',
  not_started: 'Not connected',
  unknown: 'Status unavailable',
};

export default function RevenuePanel({ notify }) {
  const [data, setData] = useState(null);
  const [payouts, setPayouts] = useState([]);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try {
      const [partners, history] = await Promise.all([getPartners(), getPayouts()]);
      setData(partners);
      setPayouts(history.payouts || []);
      setDraft({
        platform_percent: partners.config.platform_percent,
        basis: partners.config.basis,
        partners: partners.partners.map((partner) => ({
          partner_id: partner.partner_id,
          display_name: partner.display_name,
          share_percent: Number(partner.share_percent),
        })),
      });
    } catch (err) {
      notify(err.message);
    }
  }, [notify]);

  useEffect(() => {
    load();
  }, [load]);

  async function saveSplit() {
    setBusy('split');
    try {
      await updateRevenueSplit({
        config: { platform_percent: Number(draft.platform_percent), basis: draft.basis },
        partners: draft.partners,
      });
      notify('Revenue split updated.');
      await load();
    } catch (err) {
      notify(err.message);
    } finally {
      setBusy('');
    }
  }

  async function pay(partnerId, method) {
    setBusy(partnerId);
    try {
      const result = await sendPayout({ partner_id: partnerId, method });
      notify(result.message || `Payout of ${money(result.amount_cents)} ${result.status}.`);
      await load();
    } catch (err) {
      notify(err.message);
    } finally {
      setBusy('');
    }
  }

  async function connect(partnerId) {
    setBusy(partnerId);
    try {
      const { url } = await startStripeOnboarding(partnerId);
      window.open(url, '_blank', 'noopener');
      notify('Stripe onboarding opened in a new tab. Refresh here once it is finished.');
    } catch (err) {
      notify(err.message);
    } finally {
      setBusy('');
    }
  }

  async function dashboard(partnerId) {
    try {
      const { url } = await openStripeDashboard(partnerId);
      window.open(url, '_blank', 'noopener');
    } catch (err) {
      notify(err.message);
    }
  }

  if (!data || !draft) return <div className="panel"><p>Loading revenue…</p></div>;

  const shareTotal = draft.partners.reduce((sum, partner) => sum + Number(partner.share_percent || 0), 0);
  const partnerPool = 100 - Number(draft.platform_percent || 0);

  return (
    <div className="cockpit">
      <div className="metric-grid">
        <div className="metric-card">
          <small>GROSS (LAST 25 EVENTS)</small>
          <strong>{money(data.totals.gross)}</strong>
        </div>
        <div className="metric-card">
          <small>NET AFTER COSTS</small>
          <strong>{money(data.totals.net)}</strong>
        </div>
        <div className="metric-card">
          <small>PLATFORM SHARE</small>
          <strong>{money(data.totals.platform)}</strong>
        </div>
        <div className="metric-card">
          <small>PARTNER SHARE</small>
          <strong>{money(data.totals.partners)}</strong>
        </div>
      </div>

      <div className="panel">
        <div className="panel-heading">
          <span className="eyebrow">SPLIT CONFIGURATION</span>
        </div>
        <div className="director-controls">
          <label className="inline-field">
            Platform keeps (%)
            <input
              type="number"
              min="0"
              max="100"
              step="0.5"
              value={draft.platform_percent}
              onChange={(event) => setDraft({ ...draft, platform_percent: event.target.value })}
            />
          </label>
          <label className="inline-field">
            Applied to
            <select
              value={draft.basis}
              onChange={(event) => setDraft({ ...draft, basis: event.target.value })}
            >
              <option value="net">Net profit (after costs)</option>
              <option value="gross">Gross revenue</option>
            </select>
          </label>
        </div>

        {draft.basis === 'gross' && (
          <p className="fine-print warn">
            Splitting gross revenue pays partners before generation costs, Stripe fees and
            overhead are covered. On a $20 sale with $8.88 of costs the platform keeps $10.00
            but owes $8.88, leaving $1.12 — less than the $3.00 paid out. Net is the safe basis.
          </p>
        )}

        <div className="table-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Partner</th>
                <th>Share of partner pool</th>
                <th>Effective share of {draft.basis}</th>
                <th>Available</th>
                <th>Lifetime</th>
                <th>Payouts</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {draft.partners.map((partner, index) => {
                const live = data.partners.find((item) => item.partner_id === partner.partner_id) || {};
                const effective = (partnerPool * Number(partner.share_percent || 0)) / 100;
                return (
                  <tr key={partner.partner_id}>
                    <td className="mono">{partner.display_name}</td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="1"
                        value={partner.share_percent}
                        onChange={(event) => {
                          const next = [...draft.partners];
                          next[index] = { ...partner, share_percent: event.target.value };
                          setDraft({ ...draft, partners: next });
                        }}
                      />
                    </td>
                    <td>{effective.toFixed(1)}%</td>
                    <td className="mono">{money(live.available_cents)}</td>
                    <td>{money(live.lifetime_earned_cents)}</td>
                    <td>
                      {ONBOARDING_LABEL[live.onboarding_status] || 'Not connected'}
                      {live.requirements_due?.length ? ` (${live.requirements_due.length} items due)` : ''}
                    </td>
                    <td>
                      <div className="row-actions">
                        {data.stripe_configured && !live.payouts_enabled && (
                          <button
                            className="small-action"
                            onClick={() => connect(partner.partner_id)}
                            disabled={busy === partner.partner_id}
                          >
                            Connect Stripe
                          </button>
                        )}
                        {data.stripe_configured && live.payouts_enabled && (
                          <button className="small-action" onClick={() => dashboard(partner.partner_id)}>
                            Stripe dashboard
                          </button>
                        )}
                        <button
                          className="small-action"
                          onClick={() => pay(partner.partner_id)}
                          disabled={busy === partner.partner_id || !live.available_cents}
                        >
                          Pay {money(live.available_cents)}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className={Math.abs(shareTotal - 100) > 0.01 ? 'fine-print warn' : 'fine-print'}>
          Partner shares total {shareTotal}% of the {partnerPool}% partner pool.
          {Math.abs(shareTotal - 100) > 0.01
            ? ' They must total 100% before this can be saved.'
            : ''}
        </p>

        <button
          className="primary"
          onClick={saveSplit}
          disabled={busy === 'split' || Math.abs(shareTotal - 100) > 0.01}
        >
          {busy === 'split' ? 'Saving…' : 'Save split'}
        </button>

        {!data.stripe_configured && (
          <p className="fine-print">
            Stripe is not configured, so payouts are recorded in manual mode. Add
            STRIPE_SECRET_KEY to enable Express payouts.
          </p>
        )}
      </div>

      <div className="panel">
        <div className="panel-heading">
          <span className="eyebrow">PAYOUT HISTORY</span>
        </div>
        {payouts.length ? (
          <div className="table-scroll">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Partner</th>
                  <th>Amount</th>
                  <th>Method</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {payouts.map((payout) => (
                  <tr key={payout.id}>
                    <td>{new Date(payout.created_at).toLocaleDateString()}</td>
                    <td className="mono">{payout.partner?.display_name || '—'}</td>
                    <td className="mono">{money(payout.amount_cents)}</td>
                    <td>{payout.provider.replace('_', ' ')}</td>
                    <td>{payout.status}</td>
                    <td>
                      {payout.status === 'pending' && (
                        <div className="row-actions">
                          <button
                            className="small-action"
                            onClick={async () => {
                              await markPayout(payout.id, 'paid');
                              notify('Marked as paid.');
                              load();
                            }}
                          >
                            Mark paid
                          </button>
                          <button
                            className="small-action"
                            onClick={async () => {
                              await markPayout(payout.id, 'cancelled');
                              notify('Cancelled — earnings returned to available.');
                              load();
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="fine-print">No payouts yet.</p>
        )}
      </div>
    </div>
  );
}
