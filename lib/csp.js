// Returns the origin of a configured URL, or '' when it is unset or invalid.
// requireHttps drops non-HTTPS endpoints so they are never allow-listed.
function originOf(value, { requireHttps = false } = {}) {
  try {
    if (!value) return '';
    const url = new URL(value);
    if (requireHttps && url.protocol !== 'https:') return '';
    return url.origin;
  } catch {
    return '';
  }
}

// Supabase Auth, REST and Storage are called directly from the browser, so the
// project origin must be allow-listed in connect-src or every sign-in, upload
// and signed-URL fetch is silently blocked by the CSP. STORAGE_S3_ENDPOINT is
// opt-in groundwork for S3-compatible storage and only allowed over HTTPS.
export function buildContentSecurityPolicy(env = process.env) {
  const extraConnect = [
    originOf(env.NEXT_PUBLIC_SUPABASE_URL),
    originOf(env.STORAGE_S3_ENDPOINT, { requireHttps: true }),
  ].filter(Boolean);
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://accounts.google.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: blob: https:",
    "media-src 'self' data: blob: https:",
    // Google Drive and Dropbox uploads go straight from the browser to the
    // user's own cloud account when they choose to save there.
    ['connect-src', "'self'", 'https://muapi.ai', 'https://*.muapi.ai', 'https://www.googleapis.com', 'https://oauth2.googleapis.com', 'https://accounts.google.com', 'https://api.dropboxapi.com', 'https://content.dropboxapi.com', ...extraConnect].join(' '),
    'frame-src https://accounts.google.com',
    "font-src 'self' data: https://fonts.gstatic.com",
  ].join('; ');
}
