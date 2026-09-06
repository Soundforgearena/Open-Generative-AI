'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { storeSession } from '../../../lib/cinexvideo-client';
import {
  consumeAuthNextPath,
  getSafeNextPath,
  getSupabaseBrowserClient,
} from '../../../lib/supabase-browser';

/**
 * Supabase sends the browser here after Google sign-in with a PKCE code. The
 * browser client keeps the verifier, then exchanges the code for a session.
 */
export default function AuthCallback() {
  const router = useRouter();
  const [message, setMessage] = useState('Completing sign-in...');

  useEffect(() => {
    let cancelled = false;

    async function completeSignIn() {
      try {
        const params = new URLSearchParams(window.location.search);
        const callbackError = params.get('error_description') || params.get('error');
        if (callbackError) throw new Error(callbackError);

        const code = params.get('code');
        if (!code) throw new Error('The sign-in callback did not include an authorization code.');

        const supabase = getSupabaseBrowserClient();
        const { data, error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) throw error;
        if (!data.session?.access_token) throw new Error('Supabase returned no active session.');

        storeSession(data.session);
        const nextPath = getSafeNextPath(consumeAuthNextPath());
        if (!cancelled) router.replace(nextPath);
      } catch (callbackFailure) {
        console.error('CineXVideo OAuth callback failed', callbackFailure);
        if (cancelled) return;
        const code = callbackFailure.message === 'Supabase browser authentication is not configured.'
          ? 'not_configured'
          : 'oauth_failed';
        router.replace(`/auth?error=${code}`);
      }
    }

    completeSignIn();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-950 text-white px-6">
      <div className="text-center">
        <p className="text-lg">{message}</p>
        <Link href="/" className="mt-4 inline-block text-amber-400 hover:text-amber-300">
          Back to CinexVideo
        </Link>
      </div>
    </main>
  );
}
