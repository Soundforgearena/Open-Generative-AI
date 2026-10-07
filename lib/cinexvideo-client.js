/**
 * CinexVideo browser client.
 *
 * Talks to Supabase Auth directly for sessions, and to our own /api routes for
 * everything else. No provider key or pricing rule ever reaches this file.
 */

import { getSupabaseBrowserClient } from './supabase-browser';

/* ----------------------------------------------------------------- session */

// Kept as a compatibility shim for legacy components. Supabase's browser
// client is the only session authority; never duplicate refresh tokens in
// localStorage.
export function storeSession(session) {
  return session;
}

export function getStoredSession() {
  return null;
}

export async function signOut() {
  await getSupabaseBrowserClient()?.auth.signOut();
}

export async function signIn(email, password) {
  const { data, error } = await getSupabaseBrowserClient().auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.session;
}

export async function signUp(email, password) {
  const { data, error } = await getSupabaseBrowserClient().auth.signUp({ email, password });
  if (error) throw error;
  if (data.session) return data.session;
  return { confirmation_required: true };
}

/** Returns the SDK-managed access token. The SDK refreshes it when needed. */
export async function getAccessToken() {
  const client = getSupabaseBrowserClient();
  if (!client) return null;
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  return data.session?.access_token || null;
}

/* -------------------------------------------------------------- api access */

async function api(path, { method = 'GET', body, cache, headers = {}, keepalive = false } = {}) {
  const token = await getAccessToken();
  if (!token) throw new Error('Please sign in to continue.');
  const response = await fetch(`/api${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
    ...(cache ? { cache } : {}),
    // keepalive lets a save finish even while the page is unloading.
    ...(keepalive ? { keepalive: true } : {}),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(data?.error || 'That request could not be completed.');
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

export const getAccount = () => api('/me');
export const getCatalog = () => api('/catalog');

export const listProjects = () => api('/projects');
export const getProject = (id) => api(`/projects/${id}`);
export const updateProject = (id, patch, opts = {}) => api(`/projects/${id}`, { method: 'PATCH', body: patch, ...opts });
export const createProject = (payload) => api('/projects', { method: 'POST', body: payload });

export const updateScene = (id, patch, opts = {}) => api(`/scenes/${id}`, { method: 'PATCH', body: patch, ...opts });
export const createScene = (projectId, payload = {}) => api(`/projects/${projectId}/scenes`, { method: 'POST', body: payload });
export const reorderScenes = (projectId, order) => api(`/projects/${projectId}/scenes`, { method: 'PATCH', body: { order } });
export const deleteScene = (id, { confirmTakes = false } = {}) => api(`/scenes/${id}`, { method: 'DELETE', body: { confirm_takes: confirmTakes } });

/** Director price list (credits) and, when signed in, purchased credits available. */
export const getDirectorPricing = () => api('/director');

/** Full AI Director production plan. Charged in credits (released if it fails). */
export const requestDirectorPlan = (prompt, lane) =>
  api('/director', { method: 'POST', body: { prompt, lane }, headers: { 'Idempotency-Key': crypto.randomUUID() } }).then((data) => data.plan);

/** AI Director writing help for one field. Charged in credits (released if it fails). */
export const requestDirectorAssist = ({ action, fieldType, value, instruction, context }) =>
  api('/director', {
    method: 'POST',
    body: { action, field_type: fieldType, value, instruction, context },
    headers: { 'Idempotency-Key': crypto.randomUUID() },
  });

export const startGeneration = (payload) => {
  const idempotencyKey = payload?.idempotency_key || crypto.randomUUID();
  const { idempotency_key: _ignored, ...body } = payload || {};
  return api('/generate', {
    method: 'POST',
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
};
export const quoteGeneration = (payload) =>
  api('/generate', { method: 'POST', body: { ...payload, quote_only: true } });
/** Free readiness check: runs every generation gate, never charges. */
export const preflightGeneration = (payload) =>
  api('/generate', { method: 'POST', body: { ...payload, preflight: true } });
export const checkJob = (requestId) => api(`/jobs/${requestId}`);


export const getAdminSummary = () => api('/admin/summary');
export const getAdminUsers = () => api('/admin/actions');
export const runAdminAction = (payload) => api('/admin/actions', { method: 'POST', body: payload });
export const getStripeReadiness = () => api('/admin/stripe-readiness', { cache: 'no-store' });

/* ---------------------------------------------------------------- uploads */

/** Two-step upload: sign on the server, then PUT the bytes straight to storage. */
export async function uploadReference(projectId, file, { kind = 'reference', name, notes } = {}) {
  const prepared = await api('/uploads', {
    method: 'POST',
    body: {
      project_id: projectId,
      filename: file.name,
      kind,
      name: name || file.name,
      notes,
      content_type: file.type || null,
      size_bytes: file.size,
    },
  });
  const upload = await fetch(prepared.upload_url, {
    method: 'PUT',
    // The server decides the stored content type from the validated kind, so a
    // mislabelled browser type cannot change what lands in the bucket.
    headers: { 'Content-Type': prepared.content_type || file.type || 'application/octet-stream' },
    body: file,
  });
  if (!upload.ok) {
    // Preparing an upload creates its private metadata record. Roll that record
    // back when storage rejects the bytes so the project library never shows a
    // reference that does not exist.
    if (prepared.asset?.id) {
      await deleteReference(prepared.asset.id).catch(() => {});
    }
    throw new Error('The file could not be uploaded.');
  }
  return prepared.asset;
}

export const deleteReference = (assetId) =>
  api(`/uploads?asset_id=${encodeURIComponent(assetId)}`, { method: 'DELETE' });

/* ---------------------------------------------------------------- pricing */

/** Public pricing. Deliberately unauthenticated so it works signed out. */
export async function getPublicPricing() {
  const response = await fetch('/api/pricing', { cache: 'no-store' });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || 'Pricing could not be loaded.');
  return data;
}

/* ------------------------------------------------------------- job polling */

/** Poll a generation until it settles. Resolves with the final status. */
export async function waitForJob(requestId, { onTick, intervalMs = 4000, maxIntervalMs = 12000, timeoutMs = 900000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let delay = intervalMs;
  let failures = 0;
  while (Date.now() < deadline) {
    try {
      const result = await checkJob(requestId);
      failures = 0;
      onTick?.(result);
      if (result.status === 'completed' || result.status === 'failed') return result;
    } catch (error) {
      // A dropped connection or a busy server must not lose the job: keep
      // polling with backoff. Only give up on auth or not-found errors.
      if (error.status === 401 || error.status === 403 || error.status === 404) throw error;
      failures += 1;
      if (failures > 20) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, delay + Math.random() * 500));
    // Back off gradually so thousands of open studios don't hammer the API.
    delay = Math.min(maxIntervalMs, Math.round(delay * 1.25));
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

/* ----------------------------------------------------------- monthly plans */

export const getSubscription = () => api('/billing/subscription');
export const startSubscription = (planCode) =>
  api('/billing/subscription', { method: 'POST', body: { plan_code: planCode } });
export const updateSubscription = (action) =>
  api('/billing/subscription', { method: 'PATCH', body: { action } });

/* ------------------------------------------------------------ payment mode */

export const getPaymentMode = () => api('/admin/payment-mode');
export const setPaymentMode = (mode, confirm) =>
  api('/admin/payment-mode', { method: 'POST', body: { mode, confirm } });

/* ------------------------------------------------------- finished video */

/** Price and readiness for the finished video (free watermarked, or clean). */
export const quoteFinishedVideo = (projectId, clean = false) =>
  api('/exports/video', { method: 'POST', body: { project_id: projectId, clean, quote_only: true } });

/**
 * Render the finished video and return it as a file (Blob) in the browser. Watermarked is free;
 * clean costs purchased credits (charged only if the render succeeds).
 * `onPhase('rendering'|'downloading')` and `onProgress(0..1)` drive the UI.
 */
export async function renderFinishedVideoFile(projectId, { clean = false, onPhase, onProgress } = {}) {
  const token = await getAccessToken();
  if (!token) throw new Error('Please sign in to continue.');
  onPhase?.('rendering');
  const response = await fetch('/api/exports/video', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ project_id: projectId, clean }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    const error = new Error(data?.error || 'Your video could not be rendered.');
    error.status = response.status;
    error.data = data;
    throw error;
  }
  onPhase?.('downloading');
  const total = Number(response.headers.get('content-length') || 0);
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (total) onProgress?.(received / total);
  }
  const disposition = response.headers.get('content-disposition') || '';
  const match = /filename\*=UTF-8''([^;]+)/i.exec(disposition) || /filename="([^"]+)"/i.exec(disposition);
  const name = match ? decodeURIComponent(match[1]) : 'CineXVideo.mp4';
  const blob = new Blob(chunks, { type: 'video/mp4' });
  return { blob, name, credits: Number(response.headers.get('x-credits-charged') || 0), size: received };
}

/** Save a rendered video to this device (Downloads / Files app). */
export function saveBlobToDevice(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/* ------------------------------------------------- premieres (admin) */
export const getPremieresReadiness = () => api('/admin/storage', { cache: 'no-store' });
export const testStorageServer = () => api('/admin/storage', { method: 'POST' });
