import { redirect } from 'next/navigation';
import { createClient, isAdmin } from '@/lib/cinexvideo-server';

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
