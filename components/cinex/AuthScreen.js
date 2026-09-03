'use client';

import { useState } from 'react';
import { signIn, signUp } from '@/lib/cinexvideo-client';

export default function AuthScreen({ onSignedIn }) {
  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (mode === 'signin') {
        await signIn(email.trim(), password);
        onSignedIn();
      } else {
        const result = await signUp(email.trim(), password);
        if (result?.confirmation_required) {
          setMessage('Check your inbox to confirm your address, then sign in.');
          setMode('signin');
        } else {
          onSignedIn();
        }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <div className="auth-card">
        <div className="brand">
          <span className="brand-mark">C</span>
          <span>CINEXVIDEO</span>
        </div>
        <h1 className="auth-title">Direct every frame.</h1>
        <p>Turn an idea into a treatment, a storyboard, generated scenes, and a finished cut.</p>

        <form onSubmit={submit} className="auth-form">
          <label>
            Email
            <input
              type="email"
              value={email}
              autoComplete="email"
              required
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              required
              minLength={8}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>

          {error && <span className="auth-error">{error}</span>}
          {message && <span className="auth-note">{message}</span>}

          <button type="submit" className="primary full" disabled={busy}>
            {busy ? 'Working…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <button
          type="button"
          className="auth-switch"
          onClick={() => {
            setMode(mode === 'signin' ? 'signup' : 'signin');
            setError('');
            setMessage('');
          }}
        >
          {mode === 'signin' ? 'Need an account? Sign up' : 'Already have an account? Sign in'}
        </button>
      </div>
    </main>
  );
}
