'use client';

import { useState, useCallback } from 'react';
import { startStripeOnboarding } from '../lib/cinexvideo-client';

/**
 * Client hook to trigger Stripe Connect Express onboarding for a revenue partner.
 *
 * Goes through the shared API client so the request carries the signed-in
 * user's bearer token, which is what the server routes authenticate on.
 *
 * @param {Object} params
 * @param {string} params.partnerId - revenue_partners.id
 * @returns {{loading: boolean, error: string|null, onboardingUrl: string|null, startOnboarding: () => Promise<void>}}
 */
export function useConnectOnboarding({ partnerId }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [onboardingUrl, setOnboardingUrl] = useState(null);

  const startOnboarding = useCallback(async () => {
    setLoading(true);
    setError(null);
    setOnboardingUrl(null);

    try {
      const data = await startStripeOnboarding(partnerId);
      const url = data.url || data.onboardingUrl;
      if (!url) throw new Error('Stripe did not return an onboarding link.');

      setOnboardingUrl(url);
      // Onboarding links are single-use, so go straight there.
      window.location.href = url;
    } catch (err) {
      setError(err.message || 'An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  }, [partnerId]);

  return { loading, error, onboardingUrl, startOnboarding };
}
