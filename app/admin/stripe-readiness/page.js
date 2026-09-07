'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getAccount, getStripeReadiness } from '../../../lib/cinexvideo-client';

function StatusPill({ ok, label }) {
  return (
    <span className={`cinex-readiness-pill ${ok ? 'is-ok' : 'is-warn'}`}>
      {label}
    </span>
  );
}

function boolLabel(value, trueLabel = 'Yes', falseLabel = 'No') {
  if (value === null || value === undefined) return 'Unavailable';
  return value ? trueLabel : falseLabel;
}

export default function StripeReadinessPage() {
  const router = useRouter();
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [readiness, setReadiness] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const loadReadiness = useCallback(async ({ isRefresh = false } = {}) => {
    if (isRefresh) setRefreshing(true);
    setError(null);
    try {
      const data = await getStripeReadiness();
      setReadiness(data);
    } catch (err) {
      setError(err.message || 'Could not load Stripe readiness status.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const checkAuthorization = async () => {
      const account = await getAccount();
      if (cancelled) return;

      if (!account?.is_admin && !account?.is_super_admin) {
        router.push('/');
        return;
      }

      setIsAuthorized(true);
      await loadReadiness();
    };

    checkAuthorization().catch((err) => {
      if (cancelled) return;
      if (/sign in/i.test(err.message || '')) {
        router.push('/');
        return;
      }
      setError(err.message || 'Could not verify admin access.');
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [loadReadiness, router]);

  if (!isAuthorized || loading) {
    return (
      <div className="cinex-readiness-page cinex-readiness-loading">
        <p>{error || 'Loading admin dashboard...'}</p>
      </div>
    );
  }

  const environment = readiness?.environment;
  const stripeApi = readiness?.stripeApi;
  const webhook = readiness?.webhook;

  return (
    <div className="cinex-readiness-page">
      <div className="cinex-readiness-shell">
        <button
          type="button"
          onClick={() => router.push('/')}
          className="cinex-readiness-back"
        >
          ← Back to CinexVideo
        </button>

        <div className="cinex-readiness-header">
          <div>
            <h1>Stripe Readiness</h1>
            <p>Read-only verification of Stripe configuration (Authorized admins only)</p>
          </div>
          <button
            type="button"
            onClick={() => loadReadiness({ isRefresh: true })}
            disabled={refreshing}
            className="cinex-readiness-refresh"
          >
            {refreshing ? 'Refreshing…' : 'Refresh status'}
          </button>
        </div>

        {error && <div className="cinex-readiness-error" role="alert">{error}</div>}

        {readiness && (
          <>
            <section className="cinex-readiness-summary">
              <StatusPill
                ok={readiness.safeToEnablePayments}
                label={readiness.safeToEnablePayments ? 'Ready for payments' : 'Not ready for payments'}
              />
              <span className="cinex-readiness-timestamp">
                Checked at {new Date(readiness.checkedAt).toLocaleString()}
              </span>
            </section>

            <section className="cinex-readiness-section" aria-labelledby="env-heading">
              <h2 id="env-heading">Environment configuration</h2>
              <div className="cinex-readiness-grid">
                <div className="cinex-readiness-card">
                  <span>STRIPE_SECRET_KEY</span>
                  <strong>{boolLabel(environment?.secretKeyConfigured, 'Configured', 'Missing')}</strong>
                </div>
                <div className="cinex-readiness-card">
                  <span>NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY</span>
                  <strong>{boolLabel(environment?.publishableKeyConfigured, 'Configured', 'Missing')}</strong>
                </div>
                <div className="cinex-readiness-card">
                  <span>STRIPE_WEBHOOK_SECRET</span>
                  <strong>{boolLabel(environment?.webhookSecretConfigured, 'Configured', 'Missing')}</strong>
                </div>
                <div className="cinex-readiness-card">
                  <span>APP_URL</span>
                  <strong>{boolLabel(environment?.appUrlConfigured, 'Configured', 'Missing')}</strong>
                </div>
                <div className="cinex-readiness-card">
                  <span>Key modes match</span>
                  <strong>{boolLabel(environment?.keyModesMatch, 'Yes', 'Mismatch')}</strong>
                </div>
                <div className="cinex-readiness-card">
                  <span>Live mode allowed</span>
                  <strong>{boolLabel(environment?.liveModeAllowed)}</strong>
                </div>
              </div>
            </section>

            <section className="cinex-readiness-section" aria-labelledby="stripe-heading">
              <h2 id="stripe-heading">Stripe account status</h2>
              <div className="cinex-readiness-grid">
                <div className="cinex-readiness-card">
                  <span>Status</span>
                  <strong>{stripeApi?.status || 'Unavailable'}</strong>
                </div>
                <div className="cinex-readiness-card">
                  <span>Account</span>
                  <strong>{stripeApi?.accountId ? `${stripeApi.accountId}` : 'Not connected'}</strong>
                </div>
                <div className="cinex-readiness-card">
                  <span>Country / currency</span>
                  <strong>
                    {stripeApi?.country || 'Unavailable'} / {stripeApi?.defaultCurrency?.toUpperCase() || 'Unavailable'}
                  </strong>
                </div>
                <div className="cinex-readiness-card">
                  <span>Charges enabled</span>
                  <strong>{boolLabel(stripeApi?.chargesEnabled)}</strong>
                </div>
                <div className="cinex-readiness-card">
                  <span>Payouts enabled</span>
                  <strong>{boolLabel(stripeApi?.payoutsEnabled)}</strong>
                </div>
                <div className="cinex-readiness-card">
                  <span>Details submitted</span>
                  <strong>{boolLabel(stripeApi?.detailsSubmitted)}</strong>
                </div>
                <div className="cinex-readiness-card">
                  <span>Live mode</span>
                  <strong>{boolLabel(stripeApi?.livemode, 'Live', 'Test')}</strong>
                </div>
              </div>
              {stripeApi?.error && <p className="cinex-readiness-note">{stripeApi.error}</p>}
            </section>

            <section className="cinex-readiness-section" aria-labelledby="webhook-heading">
              <h2 id="webhook-heading">Webhook</h2>
              <div className="cinex-readiness-grid">
                <div className="cinex-readiness-card">
                  <span>Expected URL</span>
                  <strong>{webhook?.expectedUrl || 'Unavailable'}</strong>
                </div>
                <div className="cinex-readiness-card">
                  <span>Signing secret</span>
                  <strong>{boolLabel(webhook?.signingSecretConfigured, 'Configured', 'Missing')}</strong>
                </div>
                <div className="cinex-readiness-card">
                  <span>Delivery verified</span>
                  <strong>No verified webhook delivery</strong>
                </div>
              </div>
              <p className="cinex-readiness-note">{webhook?.note}</p>
            </section>

            {readiness.warnings?.length > 0 && (
              <section className="cinex-readiness-section" aria-labelledby="warnings-heading">
                <h2 id="warnings-heading">Warnings</h2>
                <ul className="cinex-readiness-list">
                  {readiness.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </section>
            )}

            {readiness.nextSteps?.length > 0 && (
              <section className="cinex-readiness-section" aria-labelledby="next-steps-heading">
                <h2 id="next-steps-heading">Next steps</h2>
                <ul className="cinex-readiness-list">
                  {readiness.nextSteps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
