function supabaseUrl() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not configured');
  return url.replace(/\/$/, '');
}

function serviceKey() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured');
  return key;
}

export function requireSecret(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

export async function getBearerUser(request) {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const response = await fetch(`${supabaseUrl()}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: serviceKey() } });
  if (!response.ok) return null;
  const user = await response.json();
  return user?.id ? user : null;
}

export async function isMaintenanceEnabled() {
  const response = await fetch(`${supabaseUrl()}/rest/v1/app_settings?key=eq.maintenance_mode&select=value`, { headers: { apikey: serviceKey(), Authorization: `Bearer ${serviceKey()}` }, cache: 'no-store' });
  if (!response.ok) return false;
  const rows = await response.json();
  return Boolean(rows?.[0]?.value?.enabled);
}

export async function callRpc(name, args) {
  const response = await fetch(`${supabaseUrl()}/rest/v1/rpc/${name}`, { method: 'POST', headers: { apikey: serviceKey(), Authorization: `Bearer ${serviceKey()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
  const data = await response.json().catch(() => null);
  return { ok: response.ok, data };
}

export function safeError(message = 'Request could not be completed', status = 400) {
  return Response.json({ error: message }, { status });
}
