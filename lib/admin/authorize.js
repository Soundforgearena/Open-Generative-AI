import { redirect } from 'next/navigation';
import { createClient, isAdmin, isSuperAdmin } from '@/lib/cinexvideo-server';

export async function requireAdmin(path = '/admin/cockpit') {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || !(await isAdmin(user.id))) redirect(`/auth?next=${encodeURIComponent(path)}`);
    return user;
  } catch {
    redirect(`/auth?next=${encodeURIComponent(path)}`);
  }
}

/** Revenue, split and partner pages: super admin only. Admins go back to /admin. */
export async function requireSuperAdmin(path = '/admin') {
  const user = await requireAdmin(path);
  let allowed = false;
  try {
    allowed = await isSuperAdmin(user.id);
  } catch {
    allowed = false;
  }
  if (!allowed) redirect('/admin');
  return user;
}

/** Role check for rendering only (server components). */
export async function currentAdminRole() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || !(await isAdmin(user.id))) return null;
    return (await isSuperAdmin(user.id)) ? 'super_admin' : 'admin';
  } catch {
    return null;
  }
}
