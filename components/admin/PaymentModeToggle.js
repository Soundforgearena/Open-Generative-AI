'use client';

import { useEffect, useState } from 'react';
import { getPaymentMode, setPaymentMode } from '@/lib/cinexvideo-client';

function Check({ ok, children }) {
  return (
    <li className={ok ? 'is-ok' : 'is-missing'}>
      <span aria-hidden="true">{ok ? '✓' : '✕'}</span> {children}
    </li>
  );
}

/**
 * Sandbox / live switch for customer payments.
 *
 * Sandbox: Stripe test cards, no real money, admins only can check out, and
 * sandbox purchases never count as revenue or partner earnings.
 * Live: real cards and real money for every customer.
 */
export default function PaymentModeToggle() {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');

  useEffect(() => {
    getPaymentMode()
      .then(setState)
      .catch((error) => setStatus(error.message || 'Payment mode could not be loaded.'));
  }, []);

  async function change(mode) {
    setBusy(true);
    setStatus('');
    try {
      const next = await setPaymentMode(mode, mode === 'live' ? typed.trim() : undefined);
      setState((current) => ({ ...current, ...next }));
      setConfirming(false);
      setTyped('');
      setStatus(mode === 'live'
        ? 'Live payments are on. Customers now pay with real cards.'
        : 'Sandbox is on. Only admins can check out, using Stripe test cards. No real money moves.');
    } catch (error) {
      setStatus(error.message || 'Payment mode could not be changed.');
    } finally {
      setBusy(false);
    }
  }

  const live = state?.mode === 'live';
  const target = live ? state?.test : state?.live;

  return (
    <section className="cinex-visibility-card cinex-payment-mode" aria-labelledby="payment-mode-title">
      <div className="cinex-visibility-copy">
        <h2 id="payment-mode-title">Payments</h2>
        {!state ? (
          <p>Checking payment mode...</p>
        ) : live ? (
          <p>Live: customers pay with real cards and real money.</p>
        ) : (
          <p>
            Sandbox: only admins can check out, using Stripe test cards (for example 4242 4242 4242 4242, any future
            date, any CVC). No real money moves, and sandbox purchases never count as revenue or partner earnings.
          </p>
        )}
        {state && (
          <ul className="cinex-payment-checks">
            <Check ok={state.test.ready}>Sandbox keys {state.test.ready ? 'ready' : 'missing (STRIPE_TEST_SECRET_KEY, STRIPE_TEST_WEBHOOK_SECRET)'}</Check>
            <Check ok={state.live.ready}>Live keys {state.live.ready ? 'ready' : 'missing or not sk_live_'}</Check>
          </ul>
        )}
      </div>

      <div className="cinex-visibility-control">
        <span className={live ? 'cinex-visibility-state is-live' : 'cinex-visibility-state'}>
          {!state ? '—' : live ? 'Live payments' : 'Sandbox'}
        </span>
        {state?.can_change && !confirming && (
          <button
            type="button"
            className={live ? 'cinex-route-secondary' : 'cinex-route-primary'}
            onClick={() => (live ? change('test') : setConfirming(true))}
            disabled={busy || !target?.ready}
            title={target?.ready ? undefined : 'Add the Stripe keys for that mode in Railway first'}
          >
            {busy ? 'Saving...' : live ? 'Switch to sandbox' : 'Go live (real payments)'}
          </button>
        )}
        {confirming && (
          <div className="cinex-payment-confirm">
            <label htmlFor="payment-live-confirm">Type LIVE to start taking real payments</label>
            <input
              id="payment-live-confirm"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
            />
            <div className="cinex-dashboard-actions">
              <button type="button" className="cinex-route-primary" disabled={busy || typed.trim() !== 'LIVE'} onClick={() => change('live')}>
                {busy ? 'Saving...' : 'Confirm go live'}
              </button>
              <button type="button" className="cinex-route-secondary" onClick={() => { setConfirming(false); setTyped(''); }}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {status && <p className="cinex-visibility-status" role="status">{status}</p>}
    </section>
  );
}
