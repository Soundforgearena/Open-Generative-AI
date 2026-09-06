'use client';

import { Suspense, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import CinexRoutePage from '@/components/CinexRoutePage';
import {
  createClient,
  getOAuthRedirectUrl,
  getSupabaseBrowserConfig,
  getAuthErrorCategory,
  getSafeNextPath,
} from '@/lib/supabase-browser';

const ERROR_MESSAGES = {
  oauth: 'Google sign-in could not be completed. Please try again.',
  oauth_cancelled: 'Google sign-in was cancelled. You can try again when ready.',
  network: 'The sign-in service could not be reached. Please try again.',
};

function AuthContent() {
  const searchParams = useSearchParams();
  const nextPath = useMemo(() => getSafeNextPath(searchParams.get('next')), [searchParams]);
  const errorCode = searchParams.get('error');
  const [isOpening, setIsOpening] = useState(false);
  const [error, setError] = useState('');
  const config = useMemo(() => getSupabaseBrowserConfig(), []);
  const category = error || errorCode || '';

  async function startGoogleSignIn() {
    setIsOpening(true);
    setError('');
    if (!config.isConfigured) {
      setError('configuration');
      setIsOpening(false);
      return;
    }
    try {
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: getOAuthRedirectUrl(nextPath),
        },
      });
      if (signInError) throw signInError;
    } catch (signInError) {
      const errorCategory = getAuthErrorCategory(signInError, 'oauth');
      if (process.env.NODE_ENV === 'development') {
        console.error('CineXVideo Google sign-in failed', errorCategory, signInError.message);
      }
      setError(errorCategory === 'configuration' ? 'configuration' : 'oauth_callback_failed');
      setIsOpening(false);
    }
  }

  return (
    <CinexRoutePage
      eyebrow="Your CineXVideo workspace"
      title="Sign in"
      description="Continue with Google to enter your cinematic AI creation studio."
    >
      <button
        type="button"
        onClick={startGoogleSignIn}
        className="cinex-route-primary"
        disabled={isOpening}
      >
        {isOpening ? 'OPENING GOOGLE SIGN-IN…' : 'CONTINUE WITH GOOGLE'}
      </button>
      {process.env.NODE_ENV === 'development' && (
        <p className="cinex-auth-dev-marker">Google OAuth build: active</p>
      )}
      {category && (
        <p className="cinex-route-error" role="alert">
          {category === 'configuration'
            ? 'Google sign-in is not configured yet. Please try again later.'
            : ERROR_MESSAGES[category] || ERROR_MESSAGES.oauth}
        </p>
      )}
    </CinexRoutePage>
  );
}

export default function AuthPage() {
  return (
    <Suspense fallback={null}>
      <AuthContent />
    </Suspense>
  );
}
