// Real faces, standard for music videos and episodes: a scene linked to a
// character photo (with the uploader's confirmed permission) is made in two
// provider steps inside one paid job:
//   1. a photoreal first frame of that exact person in the scene's setting
//      (identity-preserving image edit from their photo), then
//   2. image-to-video from that frame, so the face on screen is theirs.
// Sung scenes are then lip-synced as usual. Both steps are priced up front.

import { firstOutputUrl } from '../providers/muapi-output.js';

export const LIKENESS_BUCKET = 'cinexvideo-references';
export const KEYFRAME_MODEL = 'nano-banana-2-edit';
export const LIKENESS_VIDEO_MODEL = 'pixverse-v6-i2v';
/**
 * US cents per first frame. Source: https://muapi.ai/comparison/nano-banana-2-edit
 * (checked 2026-10-15): $0.06 at 1k, $0.09 at 2k.
 */
export const KEYFRAME_CENTS = Object.freeze({ '720p': 6, '1080p': 9 });
const KEYFRAME_RESOLUTION = Object.freeze({ '720p': '1k', '1080p': '2k' });
const PHOTO_KINDS = new Set(['character', 'reference']);

export function keyframeCents(resolution) {
  return KEYFRAME_CENTS[String(resolution || '').toLowerCase()] ?? Math.max(...Object.values(KEYFRAME_CENTS));
}

/**
 * Server-side lookup used by every project type (music videos and episodes):
 * a scene uses a real face when it is linked to one of its own project's
 * character photos and the uploader confirmed permission to use that face.
 * Returns { asset, scene } or null.
 */
export async function resolveSceneLikeness(sceneId) {
  if (!sceneId) return null;
  const { selectOne } = await import('../cinexvideo-server.js');
  const scene = await selectOne('scenes', { id: `eq.${sceneId}` }, 'id,project_id,character_asset_id,lip_sync');
  if (!scene?.character_asset_id) return null;
  const asset = await selectOne(
    'project_assets',
    { id: `eq.${scene.character_asset_id}`, project_id: `eq.${scene.project_id}` },
    'id,kind,name,notes,storage_path,likeness_consent'
  );
  if (!asset?.storage_path || !PHOTO_KINDS.has(asset.kind) || asset.likeness_consent !== true) return null;
  return { asset, scene };
}

/** Prompt for the identity-preserving first frame. */
export function keyframePrompt(scenePrompt, { name = '', notes = '', singing = false } = {}) {
  const who = [name, notes].filter(Boolean).join(', ').slice(0, 200);
  return [
    `Photorealistic cinematic film still of the exact same person as in the reference photo${who ? ` (${who})` : ''}:`,
    'keep their face, identity, bone structure, skin tone, facial hair, hairline and eyewear exactly the same.',
    singing
      ? 'Medium close-up, face fully visible and frontal, looking into the lens, mouth slightly open mid-lyric, natural relaxed expression.'
      : 'Face clearly visible and recognisable, natural expression that fits the moment.',
    'Replace the background, wardrobe and lighting to match this scene:',
    String(scenePrompt || '').slice(0, 900),
    'Real skin texture with pores, natural catchlights, shot on a cinema camera, 35mm lens, shallow depth of field.',
    'No text, no watermark, no extra people in focus, no plastic or airbrushed skin, no distorted hands.',
  ].join(' ');
}

/** Motion prompt for animating the first frame. */
export function likenessMotionPrompt(scenePrompt) {
  return `${String(scenePrompt || '').slice(0, 1200)} Keep the performer's face and identity exactly as in the first frame for the whole shot.`;
}

async function pollResult(base, apiKey, requestId, { timeoutMs = 120000, intervalMs = 2500 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    const res = await fetch(`${base}/api/v1/predictions/${encodeURIComponent(requestId)}/result`, {
      headers: { 'x-api-key': apiKey },
      cache: 'no-store',
    });
    const data = await res.json().catch(() => null);
    const status = String(data?.status || data?.data?.status || '').toLowerCase();
    if (['completed', 'succeeded', 'success'].includes(status)) {
      const url = firstOutputUrl(data?.outputs || data?.data?.outputs || data?.output);
      if (!url) throw new Error('first frame finished without an image');
      return url;
    }
    if (['failed', 'error', 'cancelled'].includes(status)) throw new Error('first frame failed');
  }
  throw new Error('first frame timed out');
}

/** Make the first frame and return its URL. Throws on any failure. */
export async function makeKeyframe({ base, apiKey, asset, scenePrompt, aspectRatio, resolution, singing = false }) {
  const { createSignedDownloadUrl } = await import('../cinexvideo-server.js');
  const photoUrl = await createSignedDownloadUrl(LIKENESS_BUCKET, asset.storage_path, 1800);
  if (!photoUrl) throw new Error('singer photo unavailable');
  const res = await fetch(`${base}/api/v1/${KEYFRAME_MODEL}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({
      images_list: [photoUrl],
      prompt: keyframePrompt(scenePrompt, { name: asset.name, notes: asset.notes, singing }),
      aspect_ratio: ['16:9', '9:16', '1:1', '21:9', '4:3', '3:4'].includes(aspectRatio) ? aspectRatio : '16:9',
      resolution: KEYFRAME_RESOLUTION[resolution] || '1k',
      output_format: 'jpg',
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error('keyframe rejected', { status: res.status, response: text.slice(0, 300) });
    throw new Error(`first frame rejected (${res.status})`);
  }
  let data = null;
  try { data = JSON.parse(text); } catch { data = null; }
  const id = data?.request_id || data?.id || data?.data?.request_id;
  if (!id) throw new Error('first frame returned no job id');
  return pollResult(base, apiKey, id);
}
