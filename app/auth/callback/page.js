'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { captureOAuthSession } from '../../../lib/cinexvideo-client';

/**
 * Supabase sends the browser here after Google sign-in with the tokens in the
 * URL fragment. We store the session client-side and continue into the app.
 */
export default function AuthCallback() {
  const router = useRouter();
  const [message, setMessage] = useState('Completing sign-in...');

  useEffect(() => {
    const session = captureOAuthSession();
    if (session?.access_token) {
      router.replace('/');
      return;
    }
    setMessage('We could not complete that sign-in. Please try again.');
  }, [router]);

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-950 text-white px-6">
      <div className="text-center">
        <p className="text-lg">{message}</p>
        <a href="/" className="mt-4 inline-block text-amber-400 hover:text-amber-300">
          Back to CinexVideo
        </a>
      </div>
    </main>
  );
}
