import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { getLocaleFromPathname } from './lib/locales';
import { isDemoModeEnabled } from './lib/demo-mode';

// Supabase Auth, REST and Storage are called directly from the browser, so the
// project origin must be allow-listed in connect-src or every sign-in, upload
// and signed-URL fetch is silently blocked by the CSP.
const SUPABASE_ORIGIN = (() => {
    try {
        return process.env.NEXT_PUBLIC_SUPABASE_URL
            ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin
            : '';
    } catch {
        return '';
    }
})();

const STORAGE_ORIGIN = (() => {
    try {
        const endpoint = process.env.STORAGE_S3_ENDPOINT;
        const url = endpoint ? new URL(endpoint) : null;
        return url?.protocol === 'https:' ? url.origin : '';
    } catch {
        return '';
    }
})();

function addSecurityHeaders(response) {
    // Prevent MIME type sniffing (CWE-693)
    response.headers.set('X-Content-Type-Options', 'nosniff');
    // Prevent clickjacking (CWE-1021)
    response.headers.set('X-Frame-Options', 'DENY');
    // Enable XSS filter in legacy browsers
    response.headers.set('X-XSS-Protection', '1; mode=block');
    // Referrer policy
    response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    // Content Security Policy - restricts script sources to prevent XSS (CWE-79).
    // connect-src covers *.muapi.ai (not just api.muapi.ai) because generated
    // media, model thumbnails, and other assets are served from cdn.muapi.ai
    // and other muapi subdomains that the renderer fetches directly.
    response.headers.set(
        'Content-Security-Policy',
        [
            "default-src 'self'",
            "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://accounts.google.com",
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
            'img-src \'self\' data: blob: https:',
            'media-src \'self\' data: blob: https:',
            // Google Drive and Dropbox uploads go straight from the browser to the
            // user's own cloud account when they choose to save there.
            `connect-src 'self' https://muapi.ai https://*.muapi.ai https://www.googleapis.com https://oauth2.googleapis.com https://accounts.google.com https://api.dropboxapi.com https://content.dropboxapi.com${SUPABASE_ORIGIN ? ` ${SUPABASE_ORIGIN}` : ''}${STORAGE_ORIGIN ? ` ${STORAGE_ORIGIN}` : ''}`,
            'frame-src https://accounts.google.com',
            "font-src 'self' data: https://fonts.gstatic.com",
        ].join('; ')
    );
    return response;
}

export async function middleware(request) {
    const url = request.nextUrl;

    // The under-construction gate itself lives in the root layout, which can
    // read app_settings and check admin membership. Middleware only forwards
    // the path so the layout knows which route is being rendered — an env-only
    // redirect here used to lock admins out of their own site too.
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-pathname', url.pathname);

    let response = NextResponse.next({ request: { headers: requestHeaders } });
    let user = null;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

    const demoMode = isDemoModeEnabled();
    const protectedAppPath =
        url.pathname.startsWith('/dashboard') ||
        url.pathname.startsWith('/create') ||
        url.pathname.startsWith('/studio') ||
        url.pathname.startsWith('/account');
    // /admin is gated twice: here (before anything renders) and again by the
    // server-side requireAdmin() in the admin layout and every admin page.
    const adminPath = url.pathname === '/admin' || url.pathname.startsWith('/admin/');
    let adminVerified = false;

    // API routes authenticate their own Bearer tokens. OAuth callback handles
    // its own cookie exchange. Only refresh browser sessions for protected UI.
    if ((protectedAppPath || adminPath) && supabaseUrl && publishableKey && (!demoMode || adminPath)) {
        try {
            const supabase = createServerClient(supabaseUrl, publishableKey, {
                cookies: {
                    getAll() {
                        return request.cookies.getAll();
                    },
                    setAll(cookiesToSet) {
                        // Refreshed tokens have to reach both the server render
                        // (via the forwarded request cookies) and the browser.
                        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
                        requestHeaders.set('cookie', request.cookies.toString());
                        response = NextResponse.next({ request: { headers: requestHeaders } });
                        cookiesToSet.forEach(({ name, value, options }) =>
                            response.cookies.set(name, value, options)
                        );
                    },
                },
            });
            const result = await supabase.auth.getUser();
            user = result.data.user;
            if (adminPath && user) {
                const { data: isAdmin, error: roleError } = await supabase.rpc('is_cinex_admin', { p_user_id: user.id });
                adminVerified = !roleError && isAdmin === true;
            }
        } catch (error) {
            console.error('CineXVideo middleware auth refresh failed', { message: error.message, path: url.pathname });
        }
    }

    // Regular users (and signed-out visitors) never reach any admin page.
    // Fails closed: if the role check cannot run, access is refused.
    if (adminPath && !adminVerified) {
        if (!user) {
            const signInUrl = new URL('/auth', request.url);
            signInUrl.searchParams.set('next', `${url.pathname}${url.search}`);
            return addSecurityHeaders(NextResponse.redirect(signInUrl));
        }
        return addSecurityHeaders(NextResponse.redirect(new URL('/dashboard', request.url)));
    }

    if (protectedAppPath && !user && !demoMode) {
        const signInUrl = new URL('/auth', request.url);
        signInUrl.searchParams.set('next', `${url.pathname}${url.search}`);
        return addSecurityHeaders(NextResponse.redirect(signInUrl));
    }

    // Plain response header carrying the locale derived from the URL path
    // (same "set in middleware, read via headers() in the root layout"
    // trick the main muapi client uses — see docs/localization.md).
    response.headers.set('x-locale', getLocaleFromPathname(url.pathname));
    return addSecurityHeaders(response);
}

// Match all paths for security headers. Exclude Next.js internal paths.
export const config = {
    matcher: [
        '/api/:path*',
        '/((?!_next/static|_next/image|favicon.ico|__nextjs_original-stack-frame).*)',
    ],
};
