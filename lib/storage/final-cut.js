// The project's "Final cut": the latest finished video, kept in our private
// R2 bucket so the owner can watch or download it again without re-rendering.
// Exactly one file per project at a fixed key, so each new download replaces
// the previous one and storage never grows beyond one video per project.

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { presignUrl } from './provider.js';
import { MEDIA_REF, VIEW_TTL_SECONDS, isMediaRef, refKey, storageOn } from './media.js';

export const MAX_FINAL_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB, far above a 15-minute 1080p cut

const seg = (v) => (/^[A-Za-z0-9_-]{1,80}$/.test(String(v || '')) ? String(v) : 'unknown');

export function finalCutKey(ownerId, projectId) {
  return `finals/${seg(ownerId)}/${seg(projectId)}/final-cut.mp4`;
}

/** Same takes in the same order = same cut, whatever the watermark. */
export function cutFingerprint(takes = []) {
  return createHash('sha256').update(takes.map((t) => t.version_id).join('|')).digest('hex').slice(0, 32);
}

/**
 * A watermarked render never replaces a no-watermark final cut of the very
 * same takes (the paid version is the better copy). Anything else replaces it.
 */
export function shouldReplaceFinal(existing, { clean, cut }) {
  if (!existing?.ref) return true;
  if (!clean && existing.clean && existing.cut === cut) return false;
  return true;
}

function hashFile(file) {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(file).on('data', (d) => h.update(d)).on('error', reject).on('end', () => resolve(h.digest('hex')));
  });
}

/** Streams a file to a presigned PUT with an exact Content-Length (no buffering). */
function putFile(url, file, size, contentType, timeoutMs) {
  return new Promise((resolve) => {
    const req = httpsRequest(url, { method: 'PUT', headers: { 'content-type': contentType, 'content-length': size } }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
    req.on('error', () => resolve(0));
    createReadStream(file).on('error', () => req.destroy()).pipe(req);
  });
}

/**
 * Upload the rendered file as the project's final cut. Never throws.
 * Returns { ok, record } where record is stored on projects.final_cut.
 */
export async function saveFinalCut({ file, size, ownerId, projectId, clean, cut, seconds, width = null, height = null, env = process.env, put = putFile, head = fetch, hash = hashFile, now = () => new Date() }) {
  try {
    if (!storageOn(env)) return { ok: false, reason: 'storage_off' };
    if (!(size > 0) || size > MAX_FINAL_BYTES) return { ok: false, reason: 'too_large' };
    const key = finalCutKey(ownerId, projectId);
    const status = await put(presignUrl('PUT', key, { env, expiresIn: 3600 }), file, size, 'video/mp4', 30 * 60_000);
    if (status < 200 || status >= 300) return { ok: false, reason: 'upload_failed', status };
    const checked = await head(presignUrl('HEAD', key, { env, expiresIn: 300 }), { method: 'HEAD', signal: AbortSignal.timeout(30_000) });
    if (!checked.ok || Number(checked.headers.get('content-length')) !== size) return { ok: false, reason: 'verify_failed', status: checked.status };
    const sha256 = await hash(file);
    return {
      ok: true,
      key,
      sha256,
      record: { ref: `${MEDIA_REF}${key}`, bytes: size, clean: Boolean(clean), cut, seconds: Math.round(Number(seconds) * 100) / 100 || null, width, height, saved_at: now().toISOString() },
    };
  } catch (error) {
    return { ok: false, reason: 'error', message: String(error?.message || error).slice(0, 200) };
  }
}

/** What the Studio sees: details plus 15-minute links to watch or download. */
export function finalCutView(finalCut, title = 'CineXVideo', { env = process.env } = {}) {
  if (!finalCut?.ref || !isMediaRef(finalCut.ref) || !storageOn(env)) return null;
  const base = String(title || 'CineXVideo').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'CineXVideo';
  const name = `${base}${finalCut.clean ? '' : ' - CineXVideo'}.mp4`;
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'");
  const disposition = `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
  const key = refKey(finalCut.ref);
  return {
    saved_at: finalCut.saved_at,
    clean: Boolean(finalCut.clean),
    bytes: finalCut.bytes,
    seconds: finalCut.seconds,
    width: finalCut.width,
    height: finalCut.height,
    file_name: name,
    play_url: presignUrl('GET', key, { env, expiresIn: VIEW_TTL_SECONDS }),
    download_url: presignUrl('GET', key, { env, expiresIn: VIEW_TTL_SECONDS, query: { 'response-content-disposition': disposition, 'response-content-type': 'video/mp4' } }),
  };
}
