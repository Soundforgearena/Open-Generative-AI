import { createClient, isAdmin, isMaintenanceEnabled } from './cinexvideo-server';

/**
 * Pre-launch site gate.
 *
 * While the studio is under construction the whole site is held behind
 * /under-construction for the public, while admins get the real site so they
 * can keep building and testing against production. The switch lives in
 * app_settings.maintenance_mode, so an admin can open the site to everyone
 * from the admin control deck without a redeploy.
 */

const ALWAYS_REACHABLE = new Set([
  '/under-construction',
  '/auth',
  '/privacy',
  '/terms',
  '/refunds',
  '/health',
]);

export function isGateExemptPath(pathname) {
  if (!pathname) return true;
  if (ALWAYS_REACHABLE.has(pathname)) return true;
  return (
    pathname.startsWith('/auth/') ||
    pathname.startsWith('/api/') ||
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/favicon')
  );
}

/** True when this request should be shown the under-construction page. */
export async function shouldGateRequest(pathname) {
  if (isGateExemptPath(pathname)) return false;

  try {
    const forcedOn = process.env.CINEXVIDEO_MAINTENANCE_MODE === 'true';
    if (!forcedOn && !(await isMaintenanceEnabled())) return false;

    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    const user = data?.user;
    if (user && (await isAdmin(user.id))) return false;
    return true;
  } catch (error) {
    // Never lock the site out because of a settings lookup failure: log it and
    // serve the site normally rather than showing a wall no one can pass.
    console.error('CineXVideo site gate check failed', { message: error.message, pathname });
    return false;
  }
}
