import { createClient } from '@supabase/supabase-js';

let browserClient;

export class SupabaseConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SupabaseConfigurationError';
    this.category = 'configuration';
  }
}

export function getAuthErrorCategory(error, context = 'email') {
  if (error?.name === 'SupabaseConfigurationError') return 'configuration';
  if (context === 'oauth') return 'oauth';
  if (error instanceof TypeError || /network|fetch failed|failed to fetch/i.test(error?.message || '')) {
    return 'network';
  }
  if (error?.status === 400 || error?.status === 401 || /invalid login|invalid password|email not confirmed/i.test(error?.message || '')) {
    return 'credentials';
  }
  return 'network';
}

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
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key?.trim()) {
    const missing = [
      !url && 'NEXT_PUBLIC_SUPABASE_URL',
      !key && 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    ].filter(Boolean).join(', ');
    throw new SupabaseConfigurationError(`Missing ${missing}.`);
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new SupabaseConfigurationError('NEXT_PUBLIC_SUPABASE_URL is not a valid URL.');
  }
  if (parsedUrl.protocol !== 'https:' || !parsedUrl.hostname.endsWith('.supabase.co')) {
    throw new SupabaseConfigurationError('NEXT_PUBLIC_SUPABASE_URL must be an https Supabase URL.');
  }

  browserClient = createClient(url, key.trim(), {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  return browserClient;
}