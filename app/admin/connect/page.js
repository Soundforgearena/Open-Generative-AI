'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useRouter } from 'next/navigation';
import PartnerOnboardingCard from '../../../components/admin/PartnerOnboardingCard';

const ALLOWED_ADMIN_EMAILS = [
  'beatkitbuilder@gmail.com',
  'kingbeatexclusives@gmail.com',
  'OfficialAmaziahMusic@gmail.com',
];

export default function AdminConnectPage() {
  const router = useRouter();
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [partners, setPartners] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // The Supabase browser client reads NEXT_PUBLIC_* env vars and throws when
  // they are absent, which breaks prerendering at build time. Creating it
  // on demand keeps it out of the server render pass entirely.
  const supabaseRef = useRef(null);
  const getSupabase = useCallback(() => {
    if (!supabaseRef.current) {
      supabaseRef.current = createClientComponentClient();
    }
    return supabaseRef.current;
  }, []);

  const loadPartners = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const { data, error: queryError } = await getSupabase()
        .from('revenue_partners')
        .select('id, email, display_name, share_percent, active, stripe_account_id, onboarding_status, payouts_enabled, payout_provider')
        .order('created_at', { ascending: false });

      if (queryError) {
        setError(queryError.message);
      } else {
        setPartners(data || []);
      }
    } catch (err) {
      setError(err.message || 'Could not load revenue partners.');
    } finally {
      setLoading(false);
    }
  }, [getSupabase]);

  useEffect(() => {
    const checkAuthorization = async () => {
      const supabase = getSupabase();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        router.push('/');
        return;
      }

      const userEmail = session.user.email;
      if (!userEmail || !ALLOWED_ADMIN_EMAILS.includes(userEmail)) {
        router.push('/');
        return;
      }

      const { data: admin } = await supabase
        .from('admin_members')
        .select('role')
        .eq('user_id', session.user.id)
        .single();

      if (!admin || (admin.role !== 'super_admin' && admin.role !== 'admin')) {
        router.push('/');
        return;
      }

      setIsAuthorized(true);
      loadPartners();
    };

    checkAuthorization().catch((err) => {
      setError(err.message || 'Could not verify admin access.');
      setLoading(false);
    });
  }, [getSupabase, loadPartners, router]);

  if (!isAuthorized || loading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-black text-white flex items-center justify-center">
        <p className="text-slate-400">Loading admin dashboard...</p>
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
