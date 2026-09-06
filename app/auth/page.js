'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import CinexRoutePage from '@/components/CinexRoutePage';
import {
  getAuthErrorCategory,
  getOAuthRedirectUrl,
  getSafeNextPath,
  getSupabaseBrowserClient,
} from '@/lib/supabase-browser';

const ERROR_MESSAGES = {
  configuration: 'Google sign-in is not configured yet.',
  oauth: 'Google sign-in could not be completed. Please try again.',
  network: 'The sign-in service could not be reached. Please try again.',
};

function AuthContent() {
  const searchParams = useSearchParams();
  const nextPath = getSafeNextPath(searchParams.get('next'));
  const errorCode = searchParams.get('error');
  const [isOpening, setIsOpening] = useState(false);
  const [error, setError] = useState('');
  const category = error === 'oauth_callback_failed' || errorCode === 'oauth_callback_failed'
    ? 'oauth'
    : error || errorCode || '';

  async function startGoogleSignIn() {
    setIsOpening(true);
    setError('');
    try {
      const supabase = getSupabaseBrowserClient();
      const { error: signInError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: getOAuthRedirectUrl(nextPath) },
      });
      if (signInError) throw signInError;
    } catch (signInError) {
      const errorCategory = getAuthErrorCategory(signInError, 'oauth');
      if (process.env.NODE_ENV === 'development') {
        console.error('CineXVideo Google sign-in failed', errorCategory, signInError.message);
      }
      setError(errorCategory);
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
        {isOpening ? 'Opening Google sign-in...' : 'Continue with Google'}
      </button>
      {process.env.NODE_ENV === 'development' && (
        <p className="cinex-auth-dev-marker">Google OAuth build: active</p>
      )}
      {category && (
        <p className="cinex-route-error" role="alert">
          <strong>
            {category === 'configuration'
              ? 'Configuration unavailable'
              : category === 'oauth'
                ? 'OAuth provider error'
                : 'Network error'}:
          </strong>{' '}
          {ERROR_MESSAGES[category] || ERROR_MESSAGES.oauth}
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
