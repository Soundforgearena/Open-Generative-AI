'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getAccount, getPartners } from '../../../lib/cinexvideo-client';
import PartnerOnboardingCard from '../../../components/admin/PartnerOnboardingCard';
import RevenueSplitManager from '../../../components/admin/RevenueSplitManager';

export default function AdminConnectPage() {
  const router = useRouter();
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [partners, setPartners] = useState([]);
  const [config, setConfig] = useState(null);
  const [totals, setTotals] = useState(null);
  const [stripeConfigured, setStripeConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadPartners = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const data = await getPartners();
      setConfig(data.config || null);
      setTotals(data.totals || null);
      setStripeConfigured(Boolean(data.stripe_configured));
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

      // Revenue split and partner details are super admin only.
      if (!account?.is_super_admin) {
        router.push(account?.is_admin ? '/admin' : '/');
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
      <p className="cinex-route-description">{error || 'Loading revenue partners...'}</p>
    );
  }

  const active = partners.filter((p) => p.active !== false);
  const partnerTotal = active.reduce((sum, p) => sum + Number(p.share_percent || 0), 0);
  const platform = Number(config?.platform_percent ?? 0);

  return (
    <div className="cinex-admin-connect">
      <h1>Revenue partners</h1>
      <p className="cinex-route-description">
        Split of net revenue (after provider costs, overhead and Stripe fees). Visible to the super admin only.
        Every partner is paid through their own Stripe Express account, in their local currency.
      </p>
      <div className="cinex-split-summary" aria-label="Current split">
        <span className="is-platform">Platform keeps {platform}%</span>
        {active.map((p) => <span key={p.id}>{p.display_name} {Number(p.share_percent)}%</span>)}
        <span className={Math.abs(platform + partnerTotal - 100) < 0.01 ? '' : 'is-platform'}>Total {platform + partnerTotal}%</span>
      </div>

      {error && <p className="cinex-form-error" role="alert">{error}</p>}

      <RevenueSplitManager
        partners={partners}
        config={config}
        totals={totals}
        stripeConfigured={stripeConfigured}
        onChanged={() => loadPartners({ quiet: true })}
      />

      <h2 className="cinex-admin-subhead">Stripe connections</h2>
      <div className="cinex-partner-grid">
        {partners.map((partner) => (
          <PartnerOnboardingCard key={partner.id} partner={partner} onRefresh={loadPartners} />
        ))}
      </div>
    </div>
  );
}
