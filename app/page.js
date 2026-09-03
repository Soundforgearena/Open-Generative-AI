'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import {
  captureOAuthSession,
  getStoredSession,
  getAccount,
  getCreditPacks,
  startCheckout,
  startGoogleSignIn,
  signOut as clearStoredSession,
} from '../lib/cinexvideo-client';

export default function CinexLanding() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [credits, setCredits] = useState(0);
  const [showBilling, setShowBilling] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [packs, setPacks] = useState([]);
  const [checkoutEnabled, setCheckoutEnabled] = useState(false);
  const [billingMessage, setBillingMessage] = useState('');
  const [busyPack, setBusyPack] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      captureOAuthSession();
      if (!getStoredSession()?.access_token) return;
      try {
        const account = await getAccount();
        if (cancelled) return;
        setUser(account.user);
        setCredits(account.credits ?? 0);
      } catch {
        clearStoredSession();
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleGoogleSignIn = () => {
    setIsGoogleLoading(true);
    startGoogleSignIn();
  };

  const handleSignOut = () => {
    clearStoredSession();
    setUser(null);
    setCredits(0);
    router.refresh();
  };

  const openBilling = async () => {
    setShowBilling(true);
    setBillingMessage('');
    try {
      const data = await getCreditPacks();
      setPacks(data.packs || []);
      setCheckoutEnabled(Boolean(data.checkout_enabled));
      if (!data.checkout_enabled) {
        setBillingMessage('Credit purchases are not switched on for this deployment yet.');
      }
    } catch {
      setBillingMessage('Credit packs are temporarily unavailable.');
    }
  };

  const closeBilling = () => setShowBilling(false);

  const handleBuy = async (packCode) => {
    setBusyPack(packCode);
    setBillingMessage('');
    try {
      const { url } = await startCheckout(packCode);
      if (url) window.location.assign(url);
    } catch (err) {
      setBillingMessage(err.message || 'Checkout could not be started.');
    } finally {
      setBusyPack(null);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-black text-white">
      {/* Hero Background */}
      <div className="relative h-[80vh] overflow-hidden">
        <Image
          src="/assets/cinema/premium_large_format_digital.webp"
          alt="Cinematic film background"
          fill
          className="object-cover opacity-60"
          priority
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />
        
        {/* Navigation */}
        <nav className="relative z-10 flex items-center justify-between px-6 py-4 max-w-7xl mx-auto">
          <div className="flex items-center gap-3">
            <Image src="/cinexvideo-mark.svg" alt="CinexVideo" width={48} height={48} />
            <span className="text-2xl font-bold tracking-tight">CinexVideo</span>
          </div>
          <div className="flex items-center gap-4">
            {user ? (
              <>
                <div className="flex items-center gap-2 px-4 py-2 bg-white/10 rounded-full backdrop-blur-sm">
                  <span className="text-sm">🎬</span>
                  <span className="font-semibold">{credits.toLocaleString()} credits</span>
                </div>
                <button
                  onClick={openBilling}
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-600 rounded-lg font-semibold transition-colors"
                >
                  Add Credits
                </button>
                <button
                  onClick={handleSignOut}
                  className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors"
                >
                  Sign Out
                </button>
              </>
            ) : (
              <button
                onClick={handleGoogleSignIn}
                disabled={isGoogleLoading}
                className="px-6 py-2 bg-white text-slate-900 rounded-lg font-semibold hover:bg-slate-100 disabled:opacity-50 transition-colors"
              >
                {isGoogleLoading ? 'Signing in...' : 'Sign in with Google'}
              </button>
            )}
          </div>
        </nav>

        {/* Hero Content */}
        <div className="relative z-10 flex flex-col items-center justify-center h-full text-center px-4">
          <h1 className="text-5xl md:text-7xl font-bold mb-6 max-w-4xl">
            Create Cinematic Videos with AI
          </h1>
          <p className="text-xl md:text-2xl text-slate-300 mb-8 max-w-2xl">
            Professional-grade video generation powered by advanced AI models
          </p>
          
          {!user && (
            <button
              onClick={handleGoogleSignIn}
              disabled={isGoogleLoading}
              className="px-8 py-4 bg-amber-500 hover:bg-amber-600 rounded-xl font-bold text-lg transition-all transform hover:scale-105 disabled:opacity-50 disabled:transform-none"
            >
              {isGoogleLoading ? 'Starting...' : 'Start Creating Free'}
            </button>
          )}
        </div>
      </div>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-16">
        {/* Feature Cards */}
        <div className="grid md:grid-cols-3 gap-8 mb-16">
          <div className="p-6 bg-white/5 rounded-2xl backdrop-blur-sm border border-white/10">
            <div className="text-4xl mb-4">🎬</div>
            <h3 className="text-xl font-bold mb-2">Create a Video</h3>
            <p className="text-slate-400">Generate professional videos from text descriptions</p>
          </div>
          <div className="p-6 bg-white/5 rounded-2xl backdrop-blur-sm border border-white/10">
            <div className="text-4xl mb-4">📝</div>
            <h3 className="text-xl font-bold mb-2">Start with a Story</h3>
            <p className="text-slate-400">AI-assisted storytelling and script generation</p>
          </div>
          <div className="p-6 bg-white/5 rounded-2xl backdrop-blur-sm border border-white/10">
            <div className="text-4xl mb-4">🎨</div>
            <h3 className="text-xl font-bold mb-2">Explore Templates</h3>
            <p className="text-slate-400">Browse pre-made templates for quick creation</p>
          </div>
        </div>

        {/* CTA Section */}
        <div className="text-center py-16 border-t border-white/10">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            Ready to Create?
          </h2>
          <p className="text-xl text-slate-400 mb-8">
            Join thousands of creators using CinexVideo
          </p>
          {!user && (
            <button
              onClick={handleGoogleSignIn}
              disabled={isGoogleLoading}
              className="px-8 py-4 bg-amber-500 hover:bg-amber-600 rounded-xl font-bold text-lg transition-all transform hover:scale-105 disabled:opacity-50"
            >
              {isGoogleLoading ? 'Starting...' : 'Get Started Free'}
            </button>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-white/10 py-8">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-2">
            <Image src="/cinexvideo-mark.svg" alt="CinexVideo" width={32} height={32} />
            <span className="text-slate-400">&copy; 2026 CinexVideo</span>
          </div>
          <div className="flex gap-6 text-sm text-slate-400">
            <a href="/terms" className="hover:text-white transition-colors">Terms</a>
            <a href="/privacy" className="hover:text-white transition-colors">Privacy</a>
            <a href="/refunds" className="hover:text-white transition-colors">Refunds</a>
          </div>
        </div>
      </footer>

      {/* Billing Overlay */}
      {showBilling && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="bg-slate-900 rounded-2xl p-8 max-w-md w-full mx-4 border border-white/10">
            <h3 className="text-2xl font-bold mb-4">Add Credits</h3>
            <p className="text-slate-400 mb-6">Choose a credit pack to continue creating</p>
            <div className="space-y-4">
              {packs.map((pack, index) => (
                <button
                  key={pack.code}
                  onClick={() => handleBuy(pack.code)}
                  disabled={!checkoutEnabled || busyPack === pack.code}
                  className={`w-full p-4 rounded-xl font-semibold transition-colors disabled:opacity-50 ${
                    index === 0
                      ? 'bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold'
                      : 'bg-white/10 hover:bg-white/20'
                  }`}
                >
                  {busyPack === pack.code
                    ? 'Starting checkout...'
                    : `${pack.name} - $${(pack.price_cents / 100).toFixed(2)} for ${pack.credits.toLocaleString()} credits`}
                </button>
              ))}
              {packs.length === 0 && !billingMessage && (
                <p className="text-slate-400 text-sm">Loading credit packs...</p>
              )}
            </div>
            {billingMessage && <p className="mt-4 text-sm text-amber-300">{billingMessage}</p>}
            <button
              onClick={closeBilling}
              className="mt-6 w-full py-3 bg-white/5 hover:bg-white/10 rounded-lg transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
