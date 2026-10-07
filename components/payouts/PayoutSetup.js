'use client';

import { useCallback, useEffect, useState } from 'react';
import { getPayoutStatus, openStripeDashboard, resetStripeConnection, startStripeOnboardingInCountry } from '@/lib/cinexvideo-client';

const STATUS = {
  not_started: { label: 'Not connected', tone: 'is-missing' },
  action_required: { label: 'Stripe needs more details', tone: 'is-warn' },
  pending_verification: { label: 'Stripe is verifying you', tone: 'is-warn' },
  restricted: { label: 'Restricted by Stripe', tone: 'is-missing' },
  complete: { label: 'Ready to receive payouts', tone: 'is-ok' },
  unknown: { label: 'Checking with Stripe', tone: 'is-warn' },
};

/**
 * Self-serve Stripe Express setup for a revenue partner. Shows only the
 * partner's own payout status, never the revenue split.
 */
export default function PayoutSetup({ partnerId = null, compact = false }) {
  const [state, setState] = useState(null);
  const [country, setCountry] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await getPayoutStatus(partnerId);
      setState(data);
      if (data.payout_country) setCountry(data.payout_country);
    } catch (error) {
      setMessage(/not set up|partner/i.test(error.message || '') ? error.message : 'Sign in with your partner email to see your payouts.');
      setState({ is_partner: false });
    }
  }, [partnerId]);

  useEffect(() => {
    load();
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('stripe') === 'done') {
      setMessage('Welcome back from Stripe. Your status updates here as Stripe finishes checking.');
    }
  }, [load]);

  async function connect() {
    setBusy('connect');
    setMessage('');
    try {
      const { url } = await startStripeOnboardingInCountry(country, partnerId);
      window.location.href = url;
    } catch (error) {
      setMessage(error.message);
      setBusy('');
    }
  }

  async function dashboard() {
    setBusy('dashboard');
    try {
      const { url } = await openStripeDashboard(partnerId);
      window.open(url, '_blank', 'noopener');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy('');
    }
  }

  async function reset() {
    setBusy('reset');
    setMessage('');
    try {
      const r = await resetStripeConnection(partnerId, 'Signed in to the wrong Stripe account');
      setConfirmReset(false);
      setMessage(r.reset ? 'Stripe connection reset. Choose your country and connect again. Your earnings are safe.' : r.message || 'Nothing to reset.');
      await load();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy('');
    }
  }

  if (!state) return <p className="cinex-route-description">Loading payout status...</p>;
  if (!state.is_partner) {
    return <p className="cinex-route-description">{message || 'This account is not set up as a revenue partner. If you think it should be, sign in with the email the super admin invited.'}</p>;
  }

  const status = STATUS[state.onboarding_status] || STATUS.unknown;
  const hasAccount = state.onboarding_status !== 'not_started';

  return (
    <section className={`cinex-payout-setup ${compact ? 'is-compact' : ''}`} aria-live="polite">
      <div className="cinex-payout-head">
        <strong>{state.display_name}</strong>
        <span className={`cinex-payout-status ${status.tone}`}>{status.label}</span>
      </div>

      {!state.stripe_configured && <p className="cinex-payout-note">Stripe payouts are not switched on yet. Your earnings are being recorded and will be paid once they are.</p>}

      {state.stripe_configured && !hasAccount && (
        <div className="cinex-payout-step">
          <label htmlFor={`payout-country-${partnerId || 'me'}`}>Country where your bank account is</label>
          <select id={`payout-country-${partnerId || 'me'}`} value={country} onChange={(e) => setCountry(e.target.value)}>
            <option value="">Choose a country</option>
            {(state.countries || []).map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
          </select>
          <button type="button" className="cinex-route-primary" disabled={!country || busy === 'connect'} onClick={connect}>
            {busy === 'connect' ? 'Opening Stripe...' : 'Connect with Stripe'}
          </button>
          <p className="cinex-payout-note">Use your own name and bank. One Stripe account per partner. Country not listed? Stripe Express payouts are not available there yet; your earnings stay safe on your account until they are.</p>
        </div>
      )}

      {state.stripe_configured && hasAccount && (
        <div className="cinex-payout-step">
          {state.requirements_due?.length > 0 && <p className="cinex-payout-note">Stripe still needs {state.requirements_due.length} item{state.requirements_due.length === 1 ? '' : 's'} from you.</p>}
          <div className="cinex-payout-actions">
            {state.onboarding_status !== 'complete' && (
              <button type="button" className="cinex-route-primary" disabled={busy === 'connect'} onClick={connect}>
                {busy === 'connect' ? 'Opening Stripe...' : 'Continue Stripe setup'}
              </button>
            )}
            {state.payouts_enabled && (
              <button type="button" className="cinex-route-secondary" disabled={busy === 'dashboard'} onClick={dashboard}>Open my Stripe dashboard</button>
            )}
            <button type="button" className="cinex-route-secondary" onClick={() => setConfirmReset(true)}>Wrong Stripe account? Reset</button>
          </div>
          {confirmReset && (
            <div className="cinex-payout-confirm" role="alertdialog" aria-label="Reset Stripe connection">
              <p>This disconnects the current Stripe account so you can connect the right one. Your earnings are not affected. Accounts that have already received payouts can only be reset by the super admin.</p>
              <div className="cinex-payout-actions">
                <button type="button" className="cinex-route-primary" disabled={busy === 'reset'} onClick={reset}>{busy === 'reset' ? 'Resetting...' : 'Yes, reset it'}</button>
                <button type="button" className="cinex-route-secondary" onClick={() => setConfirmReset(false)}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}

      {message && <p className="cinex-payout-message" role="status">{message}</p>}
    </section>
  );
}
