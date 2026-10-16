// Dance shots: real moves copied from a reference clip onto the scene's
// approved still (Kling 3.0 Standard Motion Control). Invented AI dancing
// warps limbs and drifts off the beat; copied moves look human and stay on
// the beat when the reference was danced to the song.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createSignedDownloadUrl, selectOne, uploadStorageObject } from '../cinexvideo-server.js';
import { run } from '../exports/render-video.js';
import { SONG_BUCKET, withSongFile } from './audio.js';

export const MOTION_MODEL = 'kling-v3.0-std-motion-control';
export const MOTION_MIN_MS = 3_000;
export const MOTION_MAX_MS = 30_000;
const MAX_CLIP_BYTES = 50 * 1024 * 1024;

/** Short direction: the moves come from the clip, the look from the still. */
export function motionPrompt() {
  return 'The person in the image performs the exact dance moves from the video with natural weight, rhythm and real facial expressions. Keep the face and outfit exactly the same.';
}

/** The dance clip linked to a scene, if any (must carry permission). */
export async function sceneMotion(scene) {
  if (!scene?.motion_asset_id) return null;
  const asset = await selectOne(
    'project_assets',
    { id: `eq.${scene.motion_asset_id}`, project_id: `eq.${scene.project_id}`, kind: 'eq.motion' },
    'id,name,storage_path,likeness_consent'
  );
  if (!asset?.storage_path || asset.likeness_consent !== true) return null;
  return asset;
}

/**
 * Cut the scene's length out of the dance clip (from startMs), silent and
 * normalised to H.264, upload it to a fixed per-scene path and return a
 * signed URL the provider can fetch.
 */
export async function trimMotionClip({ asset, sceneId, ownerId, projectId, startMs = 0, lengthMs }) {
  return withSongFile(asset, async ({ file, dir, durationMs }) => {
    const start = Math.max(0, Number(startMs) || 0);
    if (start + lengthMs > durationMs + 50) {
      const err = new Error('dance clip too short');
      err.code = 'MOTION_TOO_SHORT';
      err.availableMs = Math.max(0, durationMs - start);
      throw err;
    }
    const out = path.join(dir, 'motion.mp4');
    await run('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', file,
      '-ss', (start / 1000).toFixed(3),
      '-t', (lengthMs / 1000).toFixed(3),
      '-an',
      '-vf', "scale='min(1280,iw)':-2,fps=30",
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      out,
    ], { timeoutMs: 180_000 });
    const body = await readFile(out);
    if (body.length > MAX_CLIP_BYTES) throw new Error('dance clip too large');
    const storagePath = `${ownerId}/${projectId}/motion/${sceneId}.mp4`;
    const ok = await uploadStorageObject(SONG_BUCKET, storagePath, body, 'video/mp4');
    if (!ok) throw new Error('dance clip upload failed');
    const url = await createSignedDownloadUrl(SONG_BUCKET, storagePath, 6 * 3600);
    if (!url) throw new Error('dance clip url failed');
    return { url, durationMs: lengthMs, storagePath };
  });
}
