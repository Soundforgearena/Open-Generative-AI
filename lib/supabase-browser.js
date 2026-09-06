import { createClient } from '@supabase/supabase-js';

let browserClient;

export function getOAuthRedirectUrl() {
  if (typeof window === 'undefined') return '/auth/callback';
  return `${window.location.origin}/auth/callback`;
}

export function getSafeNextPath(value, fallback = '/dashboard') {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) {
    return fallback;
  }
  return value;
}

export function rememberAuthNextPath(path) {
  if (typeof window !== 'undefined') {
    window.sessionStorage.setItem('cinexvideo_auth_next', getSafeNextPath(path));
  }
}

export function consumeAuthNextPath() {
  if (typeof window === 'undefined') return '/dashboard';
  const path = getSafeNextPath(window.sessionStorage.getItem('cinexvideo_auth_next'));
  window.sessionStorage.removeItem('cinexvideo_auth_next');
  return path;
}

export function getSupabaseBrowserClient() {
  if (typeof window === 'undefined') return null;
  if (browserClient) return browserClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error('Supabase browser authentication is not configured.');
  }

  browserClient = createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  return browserClient;
}