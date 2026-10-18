// Permanent home for finished takes and stills (docs/r2-storage-migration-plan.md).
//
// The AI provider only keeps outputs for about 30 days. As soon as a take or
// still is ready we copy it into our own private Cloudflare R2 bucket and
// store a reference like "media:r2/takes/<owner>/<project>/<scene>/<version>.mp4".
// The reference doubles as the per-row backend marker (dual-read): rows that
// still hold a provider URL are read from the provider, rows with a reference
// from R2. Signed links are made on demand and never stored or logged.
// Nothing in the bucket is public. Reference uploads stay on Supabase.

import { createHash } from 'node:crypto';
import { describeStorage, presignUrl } from './provider.js';

export const MEDIA_REF = 'media:r2/';
export const MAX_MEDIA_BYTES = 400 * 1024 * 1024; // no single take is near this
// Plan TTLs: 900 s for previews, up to 3600 s for renderer / AI-model reads.
export const VIEW_TTL_SECONDS = 900;
export const PROVIDER_TTL_SECONDS = 3600;

const TYPES = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
const CONTENT_TYPE = { mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

export const isMediaRef = (value) => typeof value === 'string' && value.startsWith(MEDIA_REF);
export const refKey = (value) => (isMediaRef(value) ? value.slice(MEDIA_REF.length) : null);
export const storageOn = (env = process.env) => describeStorage(env).configured;

const seg = (v) => (/^[A-Za-z0-9_-]{1,80}$/.test(String(v || '')) ? String(v) : 'unknown');

/**
 * takes/<owner>/<project>/<scene>/<version id> or stills/<owner>/<project>/<scene>/<job id>.
 * Every user's files live under their own folder; ids make backfill idempotent.
 */
export function mediaKey({ kind = 'takes', ownerId, projectId, sceneId, name }) {
  const root = kind === 'stills' ? 'stills' : 'takes';
  return `${root}/${seg(ownerId)}/${seg(projectId)}/${seg(sceneId)}/${seg(name)}`;
}

function extFromPath(pathname = '') {
  const m = /\.([a-z0-9]{2,5})$/i.exec(pathname);
  const ext = m ? m[1].toLowerCase() : '';
  if (ext === 'jpeg') return 'jpg';
  return CONTENT_TYPE[ext] ? ext : null;
}

/** Signed link for a stored reference; plain URLs pass through unchanged. */
export function resolveMedia(value, { expiresIn = VIEW_TTL_SECONDS, env = process.env } = {}) {
  if (!value) return null;
  if (!isMediaRef(value)) return value;
  if (!storageOn(env)) return null;
  return presignUrl('GET', refKey(value), { expiresIn, env });
}

async function readCapped(response, maxBytes) {
  if (!response.body?.getReader) {
    const buf = Buffer.from(await response.arrayBuffer());
    return buf.length > maxBytes ? null : buf;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) { await reader.cancel().catch(() => {}); return null; }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

/**
 * Copy one provider file into the bucket. Returns { ok, ref, bytes } or
 * { ok: false, reason }. Never throws.
 */
export async function archiveMedia(url, keyBase, { fetchImpl = fetch, env = process.env, maxBytes = MAX_MEDIA_BYTES, timeoutMs = 180_000 } = {}) {
  try {
    if (!storageOn(env)) return { ok: false, reason: 'storage_off' };
    if (isMediaRef(url)) return { ok: true, ref: url, skipped: true };
    let parsed;
    try { parsed = new URL(url); } catch { return { ok: false, reason: 'bad_url' }; }
    if (parsed.protocol !== 'https:') return { ok: false, reason: 'bad_url' };

    const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return { ok: false, reason: [403, 404, 410].includes(res.status) ? 'gone' : 'download_failed', status: res.status };
    const type = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const ext = TYPES[type] || extFromPath(parsed.pathname);
    if (!ext) return { ok: false, reason: 'bad_type', type };
    if (Number(res.headers.get('content-length') || 0) > maxBytes) return { ok: false, reason: 'too_large' };
    const body = await readCapped(res, maxBytes);
    if (!body) return { ok: false, reason: 'too_large' };
    if (body.length < 64) return { ok: false, reason: 'empty' };

    const key = `${keyBase}.${ext}`;
    const put = await fetchImpl(presignUrl('PUT', key, { env, expiresIn: 900 }), {
      method: 'PUT',
      body,
      headers: { 'content-type': CONTENT_TYPE[ext] },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!put.ok) return { ok: false, reason: 'upload_failed', status: put.status };
    // Verify the stored object (server-side HEAD) before the row points at it.
    const head = await fetchImpl(presignUrl('HEAD', key, { env, expiresIn: 300 }), { method: 'HEAD', signal: AbortSignal.timeout(30_000) });
    if (!head.ok || Number(head.headers.get('content-length')) !== body.length) {
      return { ok: false, reason: 'verify_failed', status: head.status };
    }
    return {
      ok: true,
      ref: `${MEDIA_REF}${key}`,
      key,
      bytes: body.length,
      contentType: CONTENT_TYPE[ext],
      sha256: createHash('sha256').update(body).digest('hex'),
    };
  } catch (error) {
    return { ok: false, reason: error?.name === 'TimeoutError' ? 'timeout' : 'error', message: String(error?.message || error).slice(0, 200) };
  }
}

/**
 * Provider payloads are stored with permanent references (for busy retries);
 * this turns any stored reference into a 1-hour signed link right before sending.
 */
export function resolveInputMedia(input, { env = process.env } = {}) {
  if (!input || typeof input !== 'object') return input;
  const out = { ...input };
  for (const field of ['image_url', 'video_url', 'audio_url']) {
    if (isMediaRef(out[field])) out[field] = resolveMedia(out[field], { expiresIn: PROVIDER_TTL_SECONDS, env });
  }
  if (Array.isArray(out.images_list)) {
    out.images_list = out.images_list.map((v) => (isMediaRef(v) ? resolveMedia(v, { expiresIn: PROVIDER_TTL_SECONDS, env }) : v));
  }
  return out;
}

/**
 * Remove a stored file. Not called automatically: per the plan, unreferenced
 * objects go on the weekly orphan report and are deleted only after review.
 */
export async function deleteMedia(value, { fetchImpl = fetch, env = process.env } = {}) {
  if (!isMediaRef(value) || !storageOn(env)) return false;
  try {
    const res = await fetchImpl(presignUrl('DELETE', refKey(value), { env, expiresIn: 300 }), { method: 'DELETE' });
    return res.ok || res.status === 204 || res.status === 404;
  } catch {
    return false;
  }
}
