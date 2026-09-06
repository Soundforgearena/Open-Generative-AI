import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createClient() {
  const cookieStore = await cookies();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error('Supabase server client is not configured.');
  }

  return createServerClient(supabaseUrl, supabasePublishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Cookie writes are available from route handlers such as OAuth callback.
        }
      },
    },
  });
}

/**
 * CinexVideo server helpers.
 *
 * Deliberately dependency-free: everything talks to Supabase over REST/Auth/RPC
 * with fetch so the Railway image never needs the Supabase SDK. All provider
 * keys, vendor names and margin maths stay on this side of the wire.
 */

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

function adminHeaders(extra = {}) {
  const key = serviceKey();
  return { apikey: key, Authorization: `Bearer ${key}`, ...extra };
}

export function requireSecret(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

/* ------------------------------------------------------------------ auth */

export async function getBearerUser(request) {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const response = await fetch(`${supabaseUrl()}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: serviceKey() },
    cache: 'no-store',
  });
  if (!response.ok) return null;
  const user = await response.json();
  if (!user?.id) return null;
  const status = await selectOne('user_account_status', { user_id: `eq.${user.id}` }, 'active');
  if (status && status.active === false) return null;
  return user;
}

export async function isAdmin(userId) {
  const { ok, data } = await callRpc('is_cinex_admin', { p_user_id: userId });
  return ok && data === true;
}

export async function isSuperAdmin(userId) {
  const { ok, data } = await callRpc('is_cinex_super_admin', { p_user_id: userId });
  return ok && data === true;
}

/* ------------------------------------------------------------ rest access */

function queryString(filters = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null) params.append(key, value);
  }
  return params.toString();
}

export async function selectRows(table, filters = {}, select = '*') {
  const qs = queryString({ select, ...filters });
  const response = await fetch(`${supabaseUrl()}/rest/v1/${table}?${qs}`, {
    headers: adminHeaders(),
    cache: 'no-store',
  });
  if (!response.ok) return [];
  return (await response.json()) || [];
}

export async function selectOne(table, filters = {}, select = '*') {
  const rows = await selectRows(table, { ...filters, limit: 1 }, select);
  return rows[0] || null;
}

export async function insertRows(table, payload, { upsert = false } = {}) {
  const response = await fetch(`${supabaseUrl()}/rest/v1/${table}`, {
    method: 'POST',
    headers: adminHeaders({
      'Content-Type': 'application/json',
      Prefer: `return=representation${upsert ? ',resolution=merge-duplicates' : ''}`,
    }),
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => null);
  return { ok: response.ok, data };
}

export async function updateRows(table, filters, patch) {
  const response = await fetch(`${supabaseUrl()}/rest/v1/${table}?${queryString(filters)}`, {
    method: 'PATCH',
    headers: adminHeaders({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
    body: JSON.stringify(patch),
  });
  const data = await response.json().catch(() => null);
  return { ok: response.ok, data };
}

/**
 * Call an RPC as the signed-in user rather than the service role.
 *
 * The admin_* functions guard on auth.uid() and write the acting admin into
 * user_admin_actions, so they must run with the user's own token. Using the
 * service key here would make auth.uid() null and the call would always be
 * rejected as unauthorised.
 */
export async function callRpcAsUser(name, args, accessToken) {
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!anonKey) throw new Error('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not configured');
  const response = await fetch(`${supabaseUrl()}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  const data = await response.json().catch(() => null);
  return { ok: response.ok, data };
}

export function bearerToken(request) {
  return request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || null;
}

export async function callRpc(name, args) {
  const response = await fetch(`${supabaseUrl()}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: adminHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(args),
  });
  const data = await response.json().catch(() => null);
  return { ok: response.ok, data };
}

/* ------------------------------------------------------------ app config */

export async function getSetting(key) {
  const row = await selectOne('app_settings', { key: `eq.${key}` }, 'value');
  return row?.value || null;
}

export async function isMaintenanceEnabled() {
  const value = await getSetting('maintenance_mode');
  return Boolean(value?.enabled);
}

/* --------------------------------------------------------------- storage */

export async function createSignedUploadUrl(bucket, path) {
  const response = await fetch(
    `${supabaseUrl()}/storage/v1/object/upload/sign/${bucket}/${path}`,
    { method: 'POST', headers: adminHeaders({ 'Content-Type': 'application/json' }), body: '{}' }
  );
  if (!response.ok) return null;
  const data = await response.json().catch(() => null);
  return data?.url ? `${supabaseUrl()}/storage/v1${data.url}` : null;
}

export async function createSignedDownloadUrl(bucket, path, expiresIn = 900) {
  const response = await fetch(`${supabaseUrl()}/storage/v1/object/sign/${bucket}/${path}`, {
    method: 'POST',
    headers: adminHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ expiresIn }),
  });
  if (!response.ok) return null;
  const data = await response.json().catch(() => null);
  return data?.signedURL ? `${supabaseUrl()}/storage/v1${data.signedURL}` : null;
}

/* ---------------------------------------------------------------- errors */

/**
 * Customer-safe error. Never leaks provider names, provider cost, overhead or
 * the internal margin floor — those details stay in server logs only.
 */
export function safeError(message = 'Request could not be completed', status = 400) {
  return Response.json({ error: message }, { status });
}

export async function guard(
  request,
  { requireAdminRole = false, requireSuperAdmin = false, blockOnMaintenance = false } = {}
) {
  const user = await getBearerUser(request);
  if (!user) return { error: safeError('Authentication required.', 401) };
  const admin = await isAdmin(user.id);
  const superAdmin = admin ? await isSuperAdmin(user.id) : false;
  if (requireSuperAdmin && !superAdmin) return { error: safeError('Not authorised.', 403) };
  if (requireAdminRole && !admin) return { error: safeError('Not authorised.', 403) };
  if (blockOnMaintenance && !admin && (await isMaintenanceEnabled())) {
    return { error: safeError('Creative services are temporarily unavailable.', 503) };
  }
  return { user, admin, superAdmin };
}
