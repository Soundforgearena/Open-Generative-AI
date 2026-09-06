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

function publicOrigin(request) {
  const configuredOrigin = process.env.NEXT_PUBLIC_SITE_URL?.trim()
  if (configuredOrigin) {
    try {
      const configuredUrl = new URL(configuredOrigin)
      if (configuredUrl.protocol === 'https:' || configuredUrl.protocol === 'http:') {
        return configuredUrl.origin
      }
    } catch {
      // Fall through to the proxy headers below.
    }
  }

  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || 'https'
  if (forwardedHost && (forwardedProto === 'https' || forwardedProto === 'http')) {
    return `${forwardedProto}://${forwardedHost}`
  }

  return new URL(request.url).origin
}

export async function GET(request) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const providerError = requestUrl.searchParams.get('error')
  const providerErrorCode = requestUrl.searchParams.get('error_code')
  const nextPath = safeNextPath(requestUrl.searchParams.get('next'))
  const origin = publicOrigin(request)
  const errorRedirect = new URL('/auth', origin)
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

    return NextResponse.redirect(new URL(nextPath, origin))
  } catch {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[CinexVideo Auth] OAuth callback failed unexpectedly.')
    }
    return NextResponse.redirect(errorRedirect)
  }
}
