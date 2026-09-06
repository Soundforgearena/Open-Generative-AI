import { NextResponse } from 'next/server'
import { createClient } from '@/lib/cinexvideo-server'

function safeNextPath(value) {
  if (
    !value ||
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    /^\/[a-z][a-z\d+.-]*:/i.test(value)
  ) {
    return '/dashboard'
  }

  return value
}

export async function GET(request) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const providerError = requestUrl.searchParams.get('error')
  const providerErrorCode = requestUrl.searchParams.get('error_code')
  const nextPath = safeNextPath(requestUrl.searchParams.get('next'))
  const errorRedirect = new URL('/auth', requestUrl.origin)
  errorRedirect.searchParams.set(
    'error',
    providerErrorCode === 'otp_expired' || providerError === 'access_denied'
      ? 'oauth_cancelled'
      : 'oauth_callback_failed'
  )

  if (providerError || !code) return NextResponse.redirect(errorRedirect)

  try {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (error) {
      if (process.env.NODE_ENV !== 'production') {
        console.error('[CinexVideo Auth] OAuth code exchange failed.')
      }
      return NextResponse.redirect(errorRedirect)
    }

    return NextResponse.redirect(new URL(nextPath, requestUrl.origin))
  } catch {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[CinexVideo Auth] OAuth callback failed unexpectedly.')
    }
    return NextResponse.redirect(errorRedirect)
  }
}
