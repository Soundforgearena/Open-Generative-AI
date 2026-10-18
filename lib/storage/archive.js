// Copies finished takes and stills from the AI provider into our R2 bucket.
//
// Order of operations (docs/r2-storage-migration-plan.md):
//   1. download from the provider and upload to R2,
//   2. verify the stored object (HEAD, size) and checksum it,
//   3. record it in media_objects (size, type, checksum, original provider URL),
//   4. only then point the row at the stored copy — and only if the row still
//      holds the same provider URL (a newer take or still is never overwritten).
// If any step fails the row keeps its provider URL and the sweep retries later.
// Nothing here deletes objects.

import { createHash } from 'node:crypto';
import { archiveMedia, isMediaRef, mediaKey, storageOn } from './media.js';

const inFlight = new Set();
const failures = new Map(); // url -> { count, reason, nextAt }
const MAX_TRIES = 6;

const isProviderUrl = (v) => typeof v === 'string' && /^https:\/\//i.test(v) && !isMediaRef(v);
const short = (v) => createHash('sha256').update(String(v)).digest('hex').slice(0, 16);

function noteFailure(url, reason, now = Date.now()) {
  const prev = failures.get(url) || { count: 0 };
  const count = prev.count + 1;
  // 2, 4, 8 ... minutes between attempts; a file the provider no longer has is not retried.
  failures.set(url, { count, reason, nextAt: reason === 'gone' ? Infinity : now + Math.min(60, 2 ** count) * 60_000 });
}

function shouldTry(url, now = Date.now()) {
  const f = failures.get(url);
  return !f || (f.count < MAX_TRIES && now >= f.nextAt);
}

async function ownerOf(sceneId, deps) {
  const scene = await deps.selectOne('scenes', { id: `eq.${sceneId}` }, 'id,project_id');
  if (!scene) return null;
  const project = await deps.selectOne('projects', { id: `eq.${scene.project_id}` }, 'id,owner_id');
  return project ? { ownerId: project.owner_id, projectId: project.id, sceneId: scene.id } : null;
}

async function store({ url, kind, owner, name, versionId = null }, deps) {
  const res = await archiveMedia(url, mediaKey({ kind, ...owner, name }), { fetchImpl: deps.fetchImpl, env: deps.env });
  if (!res.ok) return res;
  const logged = await deps.insertRows('media_objects', {
    storage_backend: 'r2',
    object_key: res.key,
    owner_id: owner.ownerId,
    project_id: owner.projectId,
    scene_id: owner.sceneId,
    scene_version_id: versionId,
    kind: kind === 'stills' ? 'still' : 'take',
    size_bytes: res.bytes,
    content_type: res.contentType,
    sha256: res.sha256,
    source_url: url,
  }, { upsert: true });
  if (logged && logged.ok === false) return { ok: false, reason: 'metadata_failed' };
  return res;
}

/** Archive one take (scene_versions row). */
export async function archiveTake(version, deps) {
  const url = version?.output_url;
  if (!isProviderUrl(url) || version.status !== 'completed') return { ok: false, reason: 'skip' };
  const owner = await ownerOf(version.scene_id, deps);
  if (!owner) return { ok: false, reason: 'no_owner' };
  const res = await store({ url, kind: 'takes', owner, name: version.id, versionId: version.id }, deps);
  if (!res.ok) return res;
  await deps.updateRows('scene_versions', { id: `eq.${version.id}`, output_url: `eq.${url}` }, { output_url: res.ref });
  return { ok: true, ref: res.ref, bytes: res.bytes };
}

/** Archive one scene's still (scenes.keyframe_url). */
export async function archiveStill(scene, deps) {
  const url = scene?.keyframe_url;
  if (!isProviderUrl(url)) return { ok: false, reason: 'skip' };
  const owner = await ownerOf(scene.id, deps);
  if (!owner) return { ok: false, reason: 'no_owner' };
  const res = await store({ url, kind: 'stills', owner, name: `${scene.id}-${short(url)}` }, deps);
  if (!res.ok) return res;
  await deps.updateRows('scenes', { id: `eq.${scene.id}`, keyframe_url: `eq.${url}` }, { keyframe_url: res.ref });
  return { ok: true, ref: res.ref, bytes: res.bytes };
}

async function guarded(url, task) {
  if (!url || inFlight.has(url) || !shouldTry(url)) return { ok: false, reason: 'skip' };
  inFlight.add(url);
  try {
    const res = await task();
    if (!res.ok && res.reason !== 'skip') {
      noteFailure(url, res.reason);
      console.warn('media archive deferred', res.reason, res.status || '');
    } else if (res.ok) failures.delete(url);
    return res;
  } catch (error) {
    noteFailure(url, 'error');
    console.warn('media archive error', String(error?.message || error).slice(0, 160));
    return { ok: false, reason: 'error' };
  } finally {
    inFlight.delete(url);
  }
}

/**
 * Start copying right away without making the user wait. Railway runs one
 * long-lived server, so this finishes in the background; the sweep below
 * catches anything a restart interrupts.
 */
export function archiveSoon(kind, row, deps) {
  if (!storageOn(deps.env)) return;
  const url = kind === 'take' ? row?.output_url : row?.keyframe_url;
  const task = () => (kind === 'take' ? archiveTake(row, deps) : archiveStill(row, deps));
  guarded(url, task).catch(() => {});
}

/**
 * Called by the every-minute scheduler. Copies a few leftover files per run
 * (oldest first, so nothing reaches the provider's 30-day expiry) within a
 * time budget. Never throws.
 */
export async function sweepMedia(deps, { limit = 3, budgetMs = 40_000, now = () => Date.now() } = {}) {
  const summary = { archived: 0, deferred: 0, pending: 0 };
  if (!storageOn(deps.env)) return { ...summary, storage: 'off' };
  const started = now();
  try {
    const takes = await deps.selectRows(
      'scene_versions',
      { status: 'eq.completed', output_url: 'like.https://*', order: 'created_at.asc', limit: '40' },
      'id,scene_id,version,status,output_url'
    );
    const stills = await deps.selectRows(
      'scenes',
      { keyframe_url: 'like.https://*', order: 'keyframe_at.asc.nullsfirst', limit: '40' },
      'id,keyframe_url'
    );
    summary.pending = takes.length + stills.length;
    const queue = [
      ...takes.filter((t) => shouldTry(t.output_url)).map((t) => ['take', t, t.output_url]),
      ...stills.filter((s) => shouldTry(s.keyframe_url)).map((s) => ['still', s, s.keyframe_url]),
    ].slice(0, limit);
    for (const [kind, row, url] of queue) {
      if (now() - started > budgetMs) break;
      const res = await guarded(url, () => (kind === 'take' ? archiveTake(row, deps) : archiveStill(row, deps)));
      if (res.ok) summary.archived += 1; else summary.deferred += 1;
    }
  } catch (error) {
    summary.error = String(error?.message || error).slice(0, 160);
  }
  return summary;
}

export const _test = { failures, shouldTry, noteFailure, isProviderUrl };
