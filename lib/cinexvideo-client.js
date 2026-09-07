/**
 * CinexVideo browser client.
 *
 * Talks to Supabase Auth directly for sessions, and to our own /api routes for
 * everything else. No provider key or pricing rule ever reaches this file.
 */

import { getSupabaseBrowserClient } from './supabase-browser';

const STORAGE_KEY = 'cinexvideo_session';

/* ----------------------------------------------------------------- session */

export function storeSession(session) {
  if (typeof window === 'undefined' || !session?.access_token) return session;
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ ...session, expires_at: Math.floor(Date.now() / 1000) + (session.expires_in || 3600) })
  );
  return session;
}

export function getStoredSession() {
  if (typeof window === 'undefined') return null;
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null');
  } catch {
    return null;
  }
}

export async function signOut() {
  try {
    await getSupabaseBrowserClient()?.auth.signOut();
  } catch {
    // Always clear the local API session even if Supabase sign-out is offline.
  } finally {
    if (typeof window !== 'undefined') window.localStorage.removeItem(STORAGE_KEY);
  }
}

export async function signIn(email, password) {
  const { data, error } = await getSupabaseBrowserClient().auth.signInWithPassword({ email, password });
  if (error) throw error;
  return storeSession(data.session);
}

export async function signUp(email, password) {
  const { data, error } = await getSupabaseBrowserClient().auth.signUp({ email, password });
  if (error) throw error;
  if (data.session) return storeSession(data.session);
  return { confirmation_required: true };
}

async function refreshSession(session) {
  if (!session?.refresh_token) return null;
  try {
    const { data, error } = await getSupabaseBrowserClient().auth.refreshSession({
      refresh_token: session.refresh_token,
    });
    if (error) throw error;
    return storeSession(data.session);
  } catch {
    signOut();
    return null;
  }
}

/** Returns a valid access token, refreshing shortly before expiry. */
export async function getAccessToken() {
  const session = getStoredSession();
  if (!session?.access_token) return null;
  const expiring = session.expires_at && session.expires_at - 60 <= Math.floor(Date.now() / 1000);
  if (!expiring) return session.access_token;
  const refreshed = await refreshSession(session);
  return refreshed?.access_token || null;
}

/* -------------------------------------------------------------- api access */

async function api(path, { method = 'GET', body, cache } = {}) {
  const token = await getAccessToken();
  if (!token) throw new Error('Please sign in to continue.');
  const response = await fetch(`/api${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    ...(cache ? { cache } : {}),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || 'That request could not be completed.');
  return data;
}

export const getAccount = () => api('/me');
export const getCatalog = () => api('/catalog');

export const listProjects = () => api('/projects');
export const getProject = (id) => api(`/projects/${id}`);
export const updateProject = (id, patch) => api(`/projects/${id}`, { method: 'PATCH', body: patch });
export const createProject = (payload) => api('/projects', { method: 'POST', body: payload });

export const updateScene = (id, patch) => api(`/scenes/${id}`, { method: 'PATCH', body: patch });

export const requestDirectorPlan = (prompt, lane) =>
  api('/director', { method: 'POST', body: { prompt, lane } }).then((data) => data.plan);

export const startGeneration = (payload) => api('/generate', { method: 'POST', body: payload });
export const checkJob = (requestId) => api(`/jobs/${requestId}`);

export const quoteExport = (payload) => api('/exports', { method: 'POST', body: payload });
export const confirmExport = (payload) =>
  api('/exports', { method: 'POST', body: { ...payload, confirm: true } });

export const getAdminSummary = () => api('/admin/summary');
export const getAdminUsers = () => api('/admin/actions');
export const runAdminAction = (payload) => api('/admin/actions', { method: 'POST', body: payload });
export const getStripeReadiness = () => api('/admin/stripe-readiness', { cache: 'no-store' });

/* ---------------------------------------------------------------- uploads */

/** Two-step upload: sign on the server, then PUT the bytes straight to storage. */
export async function uploadReference(projectId, file, { kind = 'reference', name, notes } = {}) {
  const prepared = await api('/uploads', {
    method: 'POST',
    body: { project_id: projectId, filename: file.name, kind, name: name || file.name, notes },
  });
  const upload = await fetch(prepared.upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
  if (!upload.ok) throw new Error('The file could not be uploaded.');
  return prepared.asset;
}

/* ------------------------------------------------------------- job polling */

/** Poll a generation until it settles. Resolves with the final status. */
export async function waitForJob(requestId, { onTick, intervalMs = 4000, timeoutMs = 900000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await checkJob(requestId);
    onTick?.(result);
    if (result.status === 'completed' || result.status === 'failed') return result;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('This generation is taking longer than expected. Check back shortly.');
}

/* ------------------------------------------------- revenue split & payouts */

export const getPartners = () => api('/admin/partners');
export const updateRevenueSplit = (payload) => api('/admin/partners', { method: 'PATCH', body: payload });

export const getPayouts = () => api('/admin/payouts');
export const sendPayout = (payload) => api('/admin/payouts', { method: 'POST', body: payload });
export const markPayout = (payoutId, status, reference) =>
  api('/admin/payouts', { method: 'PATCH', body: { payout_id: payoutId, status, reference } });

export const getPayoutStatus = (partnerId) =>
  api(`/partners/connect${partnerId ? `?partner_id=${encodeURIComponent(partnerId)}` : ''}`);

/** Returns a single-use Stripe onboarding URL. */
export const startStripeOnboarding = (partnerId) =>
  api('/partners/connect', { method: 'POST', body: partnerId ? { partner_id: partnerId } : {} });

export const openStripeDashboard = (partnerId) =>
  api('/partners/connect', { method: 'PUT', body: partnerId ? { partner_id: partnerId } : {} });

/* ------------------------------------------------------------ credit packs */

export const getCreditPacks = () => api('/billing/checkout');
export const startCheckout = (packCode) =>
  api('/billing/checkout', { method: 'POST', body: { pack_code: packCode } });
