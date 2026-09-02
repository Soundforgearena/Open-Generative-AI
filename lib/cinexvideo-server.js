import { createClient } from '@supabase/supabase-js';

export function getAdminSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase server configuration is missing');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function requireSecret(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

export async function getBearerUser(request) {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const supabase = getAdminSupabase();
  const { data } = await supabase.auth.getUser(token);
  return data.user || null;
}

export async function isMaintenanceEnabled() {
  const supabase = getAdminSupabase();
  const { data } = await supabase.from('app_settings').select('value').eq('key', 'maintenance_mode').maybeSingle();
  return Boolean(data?.value?.enabled);
}

export function safeError(message = 'Request could not be completed') {
  return Response.json({ error: message }, { status: 400 });
}
