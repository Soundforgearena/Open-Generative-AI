'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import CinexRoutePage from '@/components/CinexRoutePage';
import { getStoredSession, requestPasswordReset, signIn, signOut, signUp } from '@/lib/cinexvideo-client';
import {
  getSafeNextPath,
  getAuthErrorCategory,
  getOAuthRedirectUrl,
  getSupabaseBrowserClient,
  rememberAuthNextPath,
} from '@/lib/supabase-browser';

export default function AuthPage() {
  const router = useRouter();
  const [error, setError] = useState('');
  const [errorCategory, setErrorCategory] = useState('');
  const [status, setStatus] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [account, setAccount] = useState(null);
  const [resetRequested, setResetRequested] = useState(false);

  const query = typeof window === 'undefined'
    ? null
    : new URLSearchParams(window.location.search);
  const errorCode = query?.get('error');
  const nextPath = getSafeNextPath(query?.get('next'));

  const errorMessage = errorCode === 'configuration'
    ? 'Sign-in is not configured on this deployment yet.'
    : errorCode === 'credentials'
      ? 'Invalid credentials. Check your email and password.'
      : errorCode === 'oauth'
        ? 'The Google sign-in provider returned an error.'
        : errorCode === 'network'
          ? 'The sign-in service could not be reached. Please try again.'
          : errorCode === 'not_configured'
    ? 'Sign-in is not configured on this deployment yet.'
    : errorCode
      ? 'We could not complete that sign-in. Please try again.'
      : '';

  useEffect(() => {
    setAccount(getStoredSession());
  }, []);

  async function startGoogleSignIn() {
    setError('');
    setErrorCategory('');
    try {
      rememberAuthNextPath(nextPath);
      const supabase = getSupabaseBrowserClient();
      const { error: signInError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: getOAuthRedirectUrl() },
      });
      if (signInError) throw signInError;
    } catch (signInError) {
      const category = getAuthErrorCategory(signInError, 'oauth');
      if (process.env.NODE_ENV === 'development') console.error('CineXVideo Google sign-in failed', category, signInError.message);
      setErrorCategory(category);
      setError(process.env.NODE_ENV === 'development' && category === 'configuration'
        ? signInError.message
        : category === 'configuration'
          ? 'Sign-in is not configured on this deployment.'
        : category === 'oauth'
          ? 'The Google sign-in provider returned an error.'
          : 'The sign-in service could not be reached. Please try again.');
    }
  }

  async function handlePasswordAuth(event, intent) {
    event.preventDefault();
    setError('');
    setErrorCategory('');
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
      const category = getAuthErrorCategory(authError);
      if (process.env.NODE_ENV === 'development') console.error(`CineXVideo ${intent} failed`, category, authError.message);
      setErrorCategory(category);
      setError(process.env.NODE_ENV === 'development' && category === 'configuration'
        ? authError.message
        : category === 'configuration'
          ? 'Sign-in is not configured on this deployment.'
        : category === 'credentials'
          ? 'Invalid email or password. Check your details and try again.'
          : 'The sign-in service could not be reached. Please try again.');
    }
  }

  async function handleSignOut() {
    await signOut();
    setAccount(null);
    setStatus('You have been signed out.');
  }

  async function handlePasswordReset() {
    if (!email.trim()) {
      setError('Enter your email address first.');
      return;
    }
    setError('');
    setStatus('');
    try {
      await requestPasswordReset(email.trim());
      setResetRequested(true);
      setStatus('If an account exists for that email, a reset link is on its way.');
    } catch (resetError) {
      if (process.env.NODE_ENV === 'development') console.error('CineXVideo password reset request failed', resetError.message);
      setError(process.env.NODE_ENV === 'development'
        ? resetError.message
        : 'We could not send a reset link. Please try again.');
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
        <button type="button" className="cinex-auth-link" onClick={handlePasswordReset} disabled={resetRequested}>
          Forgot password?
        </button>
      </form>
      {status && <p className="cinex-form-success" role="status">{status}</p>}
      {(errorMessage || error) && (
        <p className="cinex-route-error" role="alert">
          <strong>{errorCategory === 'configuration' ? 'Configuration unavailable' : errorCategory === 'credentials' ? 'Invalid credentials' : errorCategory === 'oauth' ? 'OAuth provider error' : errorCategory === 'network' ? 'Network error' : 'Sign-in error'}:</strong>{' '}
          {error || errorMessage}
        </p>
      )}
    </CinexRoutePage>
  );
}