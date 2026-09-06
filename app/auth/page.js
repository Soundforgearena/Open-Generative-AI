'use client';

import { useState } from 'react';
import CinexRoutePage from '@/components/CinexRoutePage';
import { getSupabaseBrowserClient, OAUTH_REDIRECT_URL } from '@/lib/supabase-browser';

export default function AuthPage() {
  const [error, setError] = useState('');

  async function startGoogleSignIn() {
    setError('');
    try {
      const supabase = getSupabaseBrowserClient();
      const { error: signInError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: OAUTH_REDIRECT_URL },
      });
      if (signInError) throw signInError;
    } catch (signInError) {
      console.error('CineXVideo Google sign-in failed', signInError);
      setError(
        process.env.NODE_ENV === 'development'
          ? signInError.message
          : 'Sign-in is temporarily unavailable. Please try again.'
      );
    }
  }

  return (
    <CinexRoutePage
      eyebrow="Your CineXVideo workspace"
      title="Sign in"
      description="Sign in to continue creating and keep your projects together in one place."
    >
      <button type="button" onClick={startGoogleSignIn} className="cinex-route-primary">
        Continue with Google
      </button>
      {error && <p className="cinex-route-error" role="alert">{error}</p>}
    </CinexRoutePage>
  );
}