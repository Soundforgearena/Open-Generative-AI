'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-browser';
import { getAccount } from '@/lib/cinexvideo-client';

export default function CinexNavigation({ showFeatures = false }) {
  const router = useRouter();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if (!isMenuOpen) return undefined;

    function closeOnEscape(event) {
      if (event.key === 'Escape') setIsMenuOpen(false);
    }

    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [isMenuOpen]);

  useEffect(() => {
    let active = true;
    let subscription;

    try {
      const supabase = createClient();
      supabase.auth.getSession().then(({ data }) => {
        if (active) {
          setUser(data.session?.user || null);
          setAuthReady(true);
        }
      }).catch(() => {
        if (active) setAuthReady(true);
      });
      const listener = supabase.auth.onAuthStateChange((_event, session) => {
        if (active) {
          setUser(session?.user || null);
          setAuthReady(true);
          if (!session) setIsAdmin(false);
        }
      });
      subscription = listener.data.subscription;
    } catch {
      setAuthReady(true);
    }

    return () => {
      active = false;
      subscription?.unsubscribe();
    };
  }, []);

  // The admin area is server-authorised on every request; this flag only
  // decides whether the entry point is shown, so a stale value cannot grant
  // access to anything.
  useEffect(() => {
    if (!user) {
      setIsAdmin(false);
      return undefined;
    }

    let active = true;
    getAccount()
      .then((account) => {
        if (active) setIsAdmin(Boolean(account?.is_admin || account?.is_super_admin));
      })
      .catch(() => {
        if (active) setIsAdmin(false);
      });

    return () => {
      active = false;
    };
  }, [user]);

  function closeMenu() {
    setIsMenuOpen(false);
  }

  async function handleSignOut() {
    closeMenu();
    try {
      await createClient().auth.signOut();
    } finally {
      setUser(null);
      setIsAdmin(false);
      router.replace('/auth');
      router.refresh();
    }
  }

  return (
    <header className="cinex-header cinex-container">
      <Link href="/" className="cinex-home-mark" aria-label="CineXVideo home" onClick={closeMenu}>
        <img src="/favicon.jpg" alt="" aria-hidden="true" />
      </Link>
      <button
        type="button"
        className="cinex-menu-toggle"
        aria-expanded={isMenuOpen}
        aria-controls="cinex-primary-navigation"
        aria-label={isMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
        onClick={() => setIsMenuOpen((open) => !open)}
      >
        <span aria-hidden="true" />
        <span aria-hidden="true" />
        <span aria-hidden="true" />
      </button>
      <nav
        id="cinex-primary-navigation"
        className={`cinex-nav${isMenuOpen ? ' is-open' : ''}`}
        aria-label="Primary navigation"
      >
        <Link href="/create" onClick={closeMenu}>Create</Link>
        <Link href="/music-video" onClick={closeMenu}>Music Video</Link>
        <Link href="/pricing" onClick={closeMenu}>Pricing</Link>
        {showFeatures && <a href="#features" onClick={closeMenu}>Features</a>}
        {authReady && user ? (
          <>
            <Link href="/dashboard" onClick={closeMenu}>Dashboard</Link>
            <Link href="/account" onClick={closeMenu}>Account</Link>
            {isAdmin && <Link href="/admin" className="cinex-nav-admin" onClick={closeMenu}>Admin</Link>}
            <button type="button" className="cinex-nav-action" onClick={handleSignOut}>Sign out</button>
          </>
        ) : authReady ? (
          <Link href="/auth" onClick={closeMenu}>Sign in</Link>
        ) : (
          <span className="cinex-nav-auth-loading" aria-hidden="true">Account</span>
        )}
      </nav>
    </header>
  );
}
