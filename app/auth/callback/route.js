import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

function safeNextPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) {
    return '/dashboard';
  }
  return value;
}

function authErrorRedirect(request, code = 'oauth_callback_failed') {
  return NextResponse.redirect(new URL(`/auth?error=${code}`, request.url));
}

export async function GET(request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const nextPath = safeNextPath(requestUrl.searchParams.get('next'));
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!code || !supabaseUrl || !publishableKey?.trim()) return authErrorRedirect(request);
  try {
    const parsedUrl = new URL(supabaseUrl);
    if (parsedUrl.protocol !== 'https:' || !parsedUrl.hostname.endsWith('.supabase.co')) {
      return authErrorRedirect(request);
    }
  } catch {
    return authErrorRedirect(request);
  }

  const cookieStore = await cookies();
  const response = NextResponse.redirect(new URL(nextPath, request.url));
  const supabase = createServerClient(supabaseUrl, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          cookieStore.set(name, value, options);
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    if (process.env.NODE_ENV === 'development') console.error('CineXVideo OAuth callback failed', error.message);
    return authErrorRedirect(request);
  }
  return response;
}