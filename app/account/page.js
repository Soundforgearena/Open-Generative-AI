'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import CinexRoutePage from '@/components/CinexRoutePage';
import CreditStore from '@/components/cinex/CreditStore';
import { getAccount } from '@/lib/cinexvideo-client';

export default function AccountPage() {
  const [account, setAccount] = useState(null);
  const [error, setError] = useState('');
  const [storeOpen, setStoreOpen] = useState(false);
  const notify = useCallback((message) => setError(message || ''), []);

  useEffect(() => {
    getAccount()
      .then(setAccount)
      .catch((loadError) => setError(loadError.message || 'Account details could not be loaded.'));
  }, []);

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
        </section>
      ) : !error ? (
        <p className="cinex-form-success" role="status">Loading account...</p>
      ) : null}
      {error && <p className="cinex-form-error" role="alert">{error}</p>}
      {storeOpen && <CreditStore notify={notify} onClose={() => setStoreOpen(false)} />}
    </CinexRoutePage>
  );
}
