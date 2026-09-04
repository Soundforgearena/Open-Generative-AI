'use client';

import { useState } from 'react';
import { useConnectOnboarding } from '../useConnectOnboarding';

export default function PartnerOnboardingCard({ partner, onRefresh }) {
  const [message, setMessage] = useState(null);
  const {
    loading: onboardingLoading,
    error: onboardingError,
    startOnboarding,
  } = useConnectOnboarding({
    partnerId: partner.id,
    email: partner.email,
  });

  const handleStartOnboarding = async () => {
    setMessage(null);
    try {
      await startOnboarding();
      setMessage('Redirecting to Stripe onboarding...');
      // onRefresh will be called after redirect returns
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    }
  };

  const statusColor = {
    not_started: 'bg-slate-500',
    needs_onboarding: 'bg-amber-500',
    onboarding_in_progress: 'bg-blue-500',
    onboarding_submitted: 'bg-purple-500',
    active: 'bg-emerald-500',
  }[partner.onboarding_status] || 'bg-slate-500';

  const providerBadge =
    partner.payout_provider === 'stripe_express'
      ? 'Stripe Express'
      : partner.payout_provider === 'paypal'
      ? 'PayPal'
      : 'Manual';

  return (
    <div className="p-6 bg-white/5 rounded-2xl backdrop-blur-sm border border-white/10">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h3 className="text-xl font-bold">{partner.display_name || partner.email}</h3>
            <span className={`px-2 py-1 rounded text-xs font-semibold text-white ${statusColor}`}>
              {partner.onboarding_status}
            </span>
            {partner.payouts_enabled && (
              <span className="px-2 py-1 rounded text-xs font-semibold text-white bg-emerald-600">
                Payouts Enabled
              </span>
            )}
          </div>
          <div className="text-slate-400 text-sm space-y-1">
            <p>Email: {partner.email}</p>
            <p>Share: {partner.share_percent}%</p>
            <p>Provider: {providerBadge}</p>
            {partner.stripe_account_id && (
              <p>Stripe Account: <code className="text-xs bg-white/10 px-2 py-1 rounded">{partner.stripe_account_id}</code></p>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-3 min-w-[200px]">
          {!partner.stripe_account_id && partner.payout_provider === 'stripe_express' && (
            <button
              onClick={handleStartOnboarding}
              disabled={onboardingLoading}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:bg-amber-500/50 rounded-lg font-semibold transition-colors"
            >
              {onboardingLoading ? 'Starting...' : 'Start Onboarding'}
            </button>
          )}

          {partner.stripe_account_id && partner.onboarding_status === 'active' && (
            <button
              disabled
              className="px-4 py-2 bg-emerald-600/50 rounded-lg font-semibold cursor-not-allowed"
            >
              Onboarding Complete
            </button>
          )}

          {partner.stripe_account_id && partner.onboarding_status !== 'active' && (
            <a
              href={`https://dashboard.stripe.com/connect/accounts/${partner.stripe_account_id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg font-semibold text-center transition-colors"
            >
              View in Stripe
            </a>
          )}
        </div>
      </div>

      {(message || onboardingError) && (
        <div className={`mt-4 p-3 rounded-lg text-sm ${onboardingError ? 'bg-red-500/10 text-red-200' : 'bg-blue-500/10 text-blue-200'}`}>
          {onboardingError || message}
        </div>
      )}
    </div>
  );
}
