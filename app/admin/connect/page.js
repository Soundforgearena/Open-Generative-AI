'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getAccount, getPartners } from '../../../lib/cinexvideo-client';
import PartnerOnboardingCard from '../../../components/admin/PartnerOnboardingCard';

export default function AdminConnectPage() {
  const router = useRouter();
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [partners, setPartners] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadPartners = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getPartners();
      // /api/admin/partners reads the partner_balances view, which keys rows on
      // partner_id; the card renders on `id`.
      setPartners(
        (data.partners || []).map((partner) => ({ ...partner, id: partner.id || partner.partner_id }))
      );
    } catch (err) {
      setError(err.message || 'Could not load revenue partners.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    // Authorisation is enforced server-side by every /api/admin route; this
    // check only decides what to render, so it stays a simple role read.
    const checkAuthorization = async () => {
      const account = await getAccount();
      if (cancelled) return;

      if (!account?.is_admin && !account?.is_super_admin) {
        router.push('/');
        return;
      }

      setIsAuthorized(true);
      await loadPartners();
    };

    checkAuthorization().catch((err) => {
      if (cancelled) return;
      // An unauthenticated visitor gets sent home rather than shown an error.
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
  }, [loadPartners, router]);

  if (!isAuthorized || loading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-black text-white flex items-center justify-center">
        <p className="text-slate-400">{error || 'Loading admin dashboard...'}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-black text-white">
      <div className="max-w-6xl mx-auto px-6 py-16">
        <button
          onClick={() => router.push('/')}
          className="inline-flex items-center gap-2 mb-8 text-slate-400 hover:text-white transition-colors"
        >
          ← Back to CinexVideo
        </button>

        <h1 className="text-4xl font-bold mb-4">Stripe Connect Onboarding</h1>
        <p className="text-slate-400 mb-8">
          Manage revenue partner onboarding and payout configuration (Authorized admins only)
        </p>

        {error && (
          <div className="mb-8 p-4 bg-red-500/10 border border-red-500/50 rounded-lg text-red-200">
            {error}
          </div>
        )}

        <div className="grid gap-6">
          {partners.map((partner) => (
            <PartnerOnboardingCard
              key={partner.id}
              partner={partner}
              onRefresh={loadPartners}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
