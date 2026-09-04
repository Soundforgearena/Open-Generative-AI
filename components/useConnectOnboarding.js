'use client';

import { useState, useCallback } from 'react';

/**
 * Client hook to trigger Stripe Connect Express onboarding for a revenue partner.
 * @param {Object} params
 * @param {string} params.partnerId - revenue_partners.id
 * @param {string} params.email - Partner email
 * @returns {{loading: boolean, error: string|null, onboardingUrl: string|null, startOnboarding: () => Promise<void>}}
 */
export function useConnectOnboarding({ partnerId, email }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [onboardingUrl, setOnboardingUrl] = useState(null);

  const startOnboarding = useCallback(async () => {
    setLoading(true);
    setError(null);
    setOnboardingUrl(null);

    try {
      const res = await fetch('/api/billing/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partnerId, email }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to start onboarding');
      }

      setOnboardingUrl(data.onboardingUrl);

      // Redirect to Stripe's hosted onboarding
      if (data.onboardingUrl) {
        window.location.href = data.onboardingUrl;
      }
    } catch (err) {
      setError(err.message || 'An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  }, [partnerId, email]);

  return { loading, error, onboardingUrl, startOnboarding };
}
