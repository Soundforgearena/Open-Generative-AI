'use client';

import { useEffect, useState } from 'react';

/** Dropbox sends the user back here; hand the result to the studio window. */
export default function DropboxCallback() {
  const [message, setMessage] = useState('Connecting Dropbox...');
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const payload = { type: 'cinex-dropbox', code: params.get('code'), state: params.get('state'), error: params.get('error') };
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage(payload, window.location.origin);
      setMessage(payload.error ? 'Dropbox was not connected. You can close this window.' : 'Dropbox connected. You can close this window.');
      window.setTimeout(() => window.close(), 400);
    } else {
      setMessage('Return to the CineXVideo studio to finish connecting Dropbox.');
    }
  }, []);
  return (
    <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', background: '#0b0b0e', color: '#f3efe7', fontFamily: 'system-ui, sans-serif', padding: 24, textAlign: 'center' }}>
      <p>{message}</p>
    </main>
  );
}
