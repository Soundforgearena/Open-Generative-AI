'use client'

import { createBrowserClient } from '@supabase/ssr'

let browserClient

function isValidSupabaseUrl(value) {
  try {
    const parsedUrl = new URL(value)
    const isLocalDevelopment = parsedUrl.hostname === 'localhost' || parsedUrl.hostname === '127.0.0.1'
    return ['https:', ...(isLocalDevelopment ? ['http:'] : [])].includes(parsedUrl.protocol)
      && Boolean(parsedUrl.hostname)
  } catch {
    return false
  }
}

function getBrowserSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim()
  const missing = []

  if (!url) {
    missing.push('NEXT_PUBLIC_SUPABASE_URL')
  } else {
    if (!isValidSupabaseUrl(url)) {
      missing.push('NEXT_PUBLIC_SUPABASE_URL')
    }
  }

  if (!publishableKey) missing.push('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY')

  return { url, publishableKey, missing, isConfigured: missing.length === 0 }
}

export function getSupabaseBrowserConfig() {
  return getBrowserSupabaseConfig()
}

export { isValidSupabaseUrl }

export function createClient() {
  const { url, publishableKey, missing } = getBrowserSupabaseConfig()
  if (missing.length > 0) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[CinexVideo Auth] Missing or invalid public Supabase configuration: ${missing.join(', ')}`)
    }
    throw new Error('Supabase browser client is not configured.')
  }
  if (!browserClient) browserClient = createBrowserClient(url, publishableKey)
  return browserClient
}

export function getSafeNextPath(value, fallback = '/dashboard') {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    /^\/[a-z][a-z\d+.-]*:/i.test(value)
  ) return fallback
  return value
}

export function getOAuthRedirectUrl(nextPath = '/dashboard') {
  if (typeof window === 'undefined') return '/auth/callback'
  const redirectTo = new URL('/auth/callback', window.location.origin)
  redirectTo.searchParams.set('next', getSafeNextPath(nextPath))
  return redirectTo.toString()
}

export function getAuthErrorCategory(error, context = 'oauth') {
  if (/not configured|configuration/i.test(error?.message || '')) return 'configuration'
  if (context === 'oauth') return 'oauth'
  if (error instanceof TypeError || /network|fetch failed/i.test(error?.message || '')) return 'network'
  return 'network'
}

// Compatibility adapter for existing dashboard and legacy client imports.
export function getSupabaseBrowserClient() {
  return createClient()
}
