'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import CinexRoutePage from '@/components/CinexRoutePage';
import { getSupabaseBrowserClient, getSafeNextPath } from '@/lib/supabase-browser';
import { updatePassword } from '@/lib/cinexvideo-client';

export default function PasswordResetPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [status, setStatus] = useState('Checking your reset link...');
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;
    getSupabaseBrowserClient()?.auth.getSession()
      .then(({ data, error: sessionError }) => {
        if (!mounted) return;
        if (sessionError || !data.session) {
          setStatus('This reset link is missing, expired, or has already been used.');
          return;
        }
        setReady(true);
        setStatus('Choose a new password for your account.');
      })
      .catch(() => {
        if (mounted) setStatus('This reset link could not be verified.');
      });
    return () => { mounted = false; };
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();
    if (password.length < 6) {
      setError('Use at least 6 characters for your new password.');
      return;
    }
    if (password !== confirmation) {
      setError('The passwords do not match.');
      return;
    }
    setError('');
    try {
      await updatePassword(password);
      router.replace(getSafeNextPath(new URLSearchParams(window.location.search).get('next'), '/dashboard'));
    } catch (updateError) {
      console.error('CineXVideo password update failed', updateError);
      setError(process.env.NODE_ENV === 'development'
        ? updateError.message
        : 'We could not update your password. Please request a new link.');
    }
  }

  return (
    <CinexRoutePage
      eyebrow="Account recovery"
      title="Reset your password"
      description={status}
    >
      {ready ? (
        <form className="cinex-auth-form" onSubmit={handleSubmit}>
          <label>
            New password
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={6} required />
          </label>
          <label>
            Confirm password
            <input type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} minLength={6} required />
          </label>
          {error && <p className="cinex-route-error" role="alert">{error}</p>}
          <button type="submit" className="cinex-route-primary">Update password</button>
        </form>
      ) : (
        <a href="/auth" className="cinex-route-secondary-link">Return to sign in</a>
      )}
    </CinexRoutePage>
  );
}