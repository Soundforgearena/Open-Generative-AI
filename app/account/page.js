'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import CinexRoutePage from '@/components/CinexRoutePage';
import CreditStore from '@/components/cinex/CreditStore';
import { getAccount, getSubscription, updateSubscription } from '@/lib/cinexvideo-client';

export default function AccountPage() {
  const [account, setAccount] = useState(null);
  const [error, setError] = useState('');
  const [storeOpen, setStoreOpen] = useState(false);
  const [plan, setPlan] = useState(null);
  const [planBusy, setPlanBusy] = useState(false);
  const notify = useCallback((message) => setError(message || ''), []);

  useEffect(() => {
    getAccount()
      .then(setAccount)
      .catch((loadError) => setError(loadError.message || 'Account details could not be loaded.'));
    getSubscription().then(setPlan).catch(() => {});
    // /account?buy=1 (from "Buy credits" links in the studio) opens the store.
    if (new URLSearchParams(window.location.search).get('buy') === '1') setStoreOpen(true);
  }, []);

  async function changePlan(action) {
    setPlanBusy(true);
    try {
      const { subscription } = await updateSubscription(action);
      setPlan((current) => ({ ...current, subscription }));
    } catch (planError) {
      setError(planError.message);
    } finally {
      setPlanBusy(false);
    }
  }

  const sub = plan?.subscription?.live ? plan.subscription : null;
  const planName = sub ? plan.plans?.find((p) => p.code === sub.plan_code)?.name || sub.plan_code : '';
  const renews = sub?.current_period_end ? new Date(sub.current_period_end).toLocaleDateString() : '';

  return (
    <CinexRoutePage
      eyebrow="Account and billing"
      title="Your CineXVideo account"
      description="Review your credit balance and securely add generation credits."
    >
      {account ? (
        <section className="cinex-review-summary">
          <p>{account.user?.email}</p>
          <h2>{Number(account.credits || 0).toLocaleString()} credits</h2>
          <div className="cinex-dashboard-actions">
            <button type="button" className="cinex-route-primary" onClick={() => setStoreOpen(true)}>
              Add credits
            </button>
            <Link href="/dashboard" className="cinex-route-secondary-link">Back to dashboard</Link>
          </div>
          {sub && (
            <div className="cinex-account-plan">
              <p>
                <strong>{planName} plan</strong>
                {sub.status === 'past_due' ? ' · payment overdue, please update your card' : ''}
                {renews ? (sub.cancel_at_period_end ? ` · ends ${renews}` : ` · renews ${renews}`) : ''}
              </p>
              <button
                type="button"
                className="cinex-route-secondary-link"
                disabled={planBusy}
                onClick={() => changePlan(sub.cancel_at_period_end ? 'resume' : 'cancel')}
              >
                {sub.cancel_at_period_end ? 'Keep my plan' : 'Cancel at end of month'}
              </button>
            </div>
          )}
        </section>
      ) : !error ? (
        <p className="cinex-form-success" role="status">Loading account...</p>
      ) : null}
      {error && <p className="cinex-form-error" role="alert">{error}</p>}
      {storeOpen && <CreditStore notify={notify} onClose={() => setStoreOpen(false)} />}
    </CinexRoutePage>
  );
}
