'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import CinexRoutePage from '@/components/CinexRoutePage';
import { getStoredSession, signIn, signOut, signUp } from '@/lib/cinexvideo-client';
import {
  getSafeNextPath,
  getOAuthRedirectUrl,
  getSupabaseBrowserClient,
  rememberAuthNextPath,
} from '@/lib/supabase-browser';

export default function AuthPage() {
  const router = useRouter();
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [account, setAccount] = useState(null);

  const query = typeof window === 'undefined'
    ? null
    : new URLSearchParams(window.location.search);
  const errorCode = query?.get('error');
  const nextPath = getSafeNextPath(query?.get('next'));

  const errorMessage = errorCode === 'not_configured'
    ? 'Sign-in is not configured on this deployment yet.'
    : errorCode
      ? 'We could not complete that sign-in. Please try again.'
      : '';

  useEffect(() => {
    setAccount(getStoredSession());
  }, []);

  async function startGoogleSignIn() {
    setError('');
    try {
      rememberAuthNextPath(nextPath);
      const supabase = getSupabaseBrowserClient();
      const { error: signInError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: getOAuthRedirectUrl() },
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

  async function handlePasswordAuth(event, intent) {
    event.preventDefault();
    setError('');
    setStatus('');
    try {
      const session = intent === 'signup'
        ? await signUp(email, password)
        : await signIn(email, password);
      if (session.confirmation_required) {
        setStatus('Check your email to confirm your account, then sign in.');
        return;
      }
      setAccount(session);
      router.replace(nextPath);
    } catch (authError) {
      console.error(`CineXVideo ${intent} failed`, authError);
      setError(process.env.NODE_ENV === 'development'
        ? authError.message
        : 'We could not complete that request. Check your details and try again.');
    }
  }

  async function handleSignOut() {
    await signOut();
    setAccount(null);
    setStatus('You have been signed out.');
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
      {account && (
        <div className="cinex-auth-session">
          You are already signed in.
          <button type="button" onClick={handleSignOut} className="cinex-auth-secondary">
            Sign out
          </button>
        </div>
      )}
      <div className="cinex-auth-divider"><span>or use email</span></div>
      <form className="cinex-auth-form" onSubmit={(event) => handlePasswordAuth(event, 'signin')}>
        <label>
          Email
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={6} required />
        </label>
        <div className="cinex-auth-actions">
          <button type="submit" className="cinex-route-primary">Sign in</button>
          <button type="button" className="cinex-auth-secondary" onClick={(event) => handlePasswordAuth(event, 'signup')}>
            Create account
          </button>
        </div>
      </form>
      {status && <p className="cinex-form-success" role="status">{status}</p>}
      {(errorMessage || error) && (
        <p className="cinex-route-error" role="alert">{error || errorMessage}</p>
      )}
    </CinexRoutePage>
  );
}