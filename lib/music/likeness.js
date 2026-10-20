// Real faces, standard for music videos and episodes: a scene linked to a
// character photo (with the uploader's confirmed permission) is made in two
// provider steps inside one paid job:
//   1. a photoreal first frame of that exact person in the scene's setting
//      (identity-preserving image edit from their photo), then
//   2. image-to-video from that frame, so the face on screen is theirs.
// Sung scenes are then lip-synced as usual. Both steps are priced up front.

import { firstOutputUrl } from '../providers/muapi-output.js';
import { parseShotDirection } from '../studio/studio-model.js';
import { EMOTIONS } from '../director/emotion.js';
import { TEXT_MOTION_RULE, signWords, textRule } from '../director/signage.js';

export const LIKENESS_BUCKET = 'cinexvideo-references';
export const KEYFRAME_MODEL = 'nano-banana-2-edit';
// Animating an approved still (non-sung shots). Seedance 1.5 Pro (fast):
// 99.4% of 795 production jobs completed on MUAPI (7 days to 2026-10-20),
// vs 87.5% for PixVerse v6, and cheaper ($0.039/s at 1080p).
export const LIKENESS_VIDEO_MODEL = 'seedance-v1.5-pro-i2v-fast';
export const LEGACY_LIKENESS_VIDEO_MODEL = 'pixverse-v6-i2v';
// Lip sync on a finished take: VEED, 98.3% on MUAPI (Volcengine was 68.1%).
export const LIP_SYNC_MODEL = 'veed-lipsync';
/** Stills for scenes without a real face (photoreal, $0.015 each). */
export const STILL_MODEL = 'flux-krea-dev';
/** One-step sung performance: the approved still + the song slice. */
// Kling Avatar (Standard): approved still + the scene's slice of the song,
// lip sync built in. Replaced OmniHuman 1.5, which failed every production job.
export const PERFORM_MODEL = 'kling-v1-avatar-standard';
export const RETIRED_PERFORM_MODELS = Object.freeze(['omnihuman-1-5']);
export const PERFORM_MIN_MS = 5_000;
export const PERFORM_MAX_MS = 60_000;
/** Audio sent to the singing model is padded to this, safely above its 5 s minimum. */
export const PERFORM_AUDIO_MIN_MS = 5_200;
/**
 * US cents per first frame. Source: https://muapi.ai/comparison/nano-banana-2-edit
 * (checked 2026-10-15): $0.06 at 1k, $0.09 at 2k.
 */
// Plus 1 cent for the automatic face check on every first frame.
export const KEYFRAME_CENTS = Object.freeze({ '720p': 7, '1080p': 10 });
export const FACE_CHECK_MODEL = process.env.OPENAI_FACE_CHECK_MODEL || 'gpt-5-mini';

/** Thrown when the face can't be kept true to the photo; the job is refunded. */
export class FaceMismatchError extends Error {
  constructor(message = 'face did not match the photo') { super(message); this.name = 'FaceMismatchError'; }
}
/** Thrown when a still keeps showing gibberish writing; the job is refunded. */
export class StillQualityError extends Error {
  constructor(message = 'writing in the shot did not read correctly') { super(message); this.name = 'StillQualityError'; }
}

const TEXT_CHECK = 'text_ok: read EVERY piece of writing in the generated still (signs, neon, posters, menus, screens, papers, labels, clothing, vehicles). true only if each readable word is a real, correctly spelled word or name that makes sense in that place; false if any letters are gibberish, invented, misspelled, mirrored, melted or half-formed. Text that is fully out of focus and unreadable is fine. text_issue: quote the bad writing, or empty. words: list EVERY readable word you can see, copied letter by letter exactly as it appears in the image (not what it was meant to say), including partly visible words; real is true only if that exact spelling is a real word or name.';

const WORDS_SCHEMA = Object.freeze({
  type: 'array',
  items: { type: 'object', additionalProperties: false, properties: { text: { type: 'string' }, real: { type: 'boolean' } }, required: ['text', 'real'] },
});

/**
 * Writing verdict. One gibberish word fails the still: the checker copies out
 * every word it can read and judges each one, which catches near-words like
 * "ONIES" that a single overall yes/no lets through.
 */
export function textVerdict(verdict = {}) {
  const words = Array.isArray(verdict.words) ? verdict.words : [];
  const bad = words.filter((w) => w && w.real === false && String(w.text || '').trim()).map((w) => String(w.text).trim());
  const textOk = verdict.text_ok !== false && bad.length === 0;
  const issue = String(verdict.text_issue || '').trim() || (bad.length ? `"${bad.slice(0, 4).join('", "')}"` : '');
  return { textOk, textIssue: issue.slice(0, 160) };
}

async function vision(content, schema) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: FACE_CHECK_MODEL,
      reasoning: { effort: 'low' },
      max_output_tokens: 1500,
      input: [{ role: 'user', content }],
      text: { format: { type: 'json_schema', name: 'still_check', strict: true, schema } },
    }),
  });
  if (!res.ok) { console.warn('quality check unavailable', res.status); return null; }
  const data = await res.json();
  const text = data.output_text || data.output?.flatMap((o) => o.content || []).find((c) => c.type === 'output_text')?.text;
  return JSON.parse(text || '{}');
}

/**
 * Automatic check for stills without a real face: writing must be real and
 * correctly spelled, and faces and hands must look human. If the checker is
 * unavailable the still is allowed (logged).
 */
export async function checkStill({ frameUrl }) {
  try {
    const verdict = await vision([
      { type: 'input_text', text: `This is a generated film still that must look like real, human-made footage. ${TEXT_CHECK} malformed: any distorted, melted or extra facial features, warped eyes, or extra/missing fingers on visible hands. reason: one short sentence.` },
      { type: 'input_image', image_url: frameUrl, detail: 'high' },
    ], {
      type: 'object', additionalProperties: false,
      properties: { text_ok: { type: 'boolean' }, text_issue: { type: 'string' }, words: WORDS_SCHEMA, malformed: { type: 'boolean' }, reason: { type: 'string' } },
      required: ['text_ok', 'text_issue', 'words', 'malformed', 'reason'],
    });
    if (!verdict) return { ok: true, skipped: true };
    const t = textVerdict(verdict);
    return { ok: t.textOk && verdict.malformed === false, textOk: t.textOk, textIssue: t.textIssue, reason: String(verdict.reason || '').slice(0, 200) };
  } catch (error) {
    console.warn('still check failed to run', error?.message);
    return { ok: true, skipped: true };
  }
}

/** Retry instruction that names the bad writing and how to fix it. */
export function textFix(scenePrompt, issue = '') {
  const words = signWords(scenePrompt).map((w) => `"${w}"`).join(', ');
  return `IMPORTANT: the writing in the last attempt was not real${issue ? ` (${issue})` : ''}. Signs may only read ${words}, spelled exactly; otherwise make every sign blank or fully out of focus.`;
}
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
  const scene = await selectOne('scenes', { id: `eq.${sceneId}` }, 'id,project_id,character_asset_id,lip_sync,shot_direction');
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
/** Safety line added to every visual prompt (see /content-policy). */
export const SAFETY_RULE = 'Everyone is fully clothed in non-revealing clothing; no nudity, no sexual or suggestive content, no gore.';

export function keyframePrompt(scenePrompt, { name = '', notes = '', singing = false, shotDirection = '' } = {}) {
  const who = [name, notes].filter(Boolean).join(', ').slice(0, 200);
  const c = parseShotDirection(shotDirection);
  const feel = EMOTIONS[c.emotion];
  // The feeling leads: the expression and body language are what sell it.
  const expression = feel ? `a genuine, human expression of ${feel.label.toLowerCase()}: ${feel.performance}` : 'natural relaxed expression';
  return [
    `Photorealistic cinematic film still of the exact same person as in the reference photo${who ? ` (${who})` : ''}:`,
    'keep their face, identity, bone structure, skin tone, facial hair, hairline and eyewear exactly the same.',
    feel ? `The moment: viewers should feel ${feel.viewer}. Light: ${feel.light}. Colour: ${feel.grade}.` : null,
    singing
      ? `${c.shot === 'Medium Shot' ? 'Medium shot' : c.shot === 'Close-Up' ? 'Close-up' : 'Medium close-up'}, face fully visible and frontal, looking into the lens, mouth slightly open mid-lyric, ${expression}${feel ? ' (caught in the moment with eyes open)' : ''}.`
      : `Face clearly visible and recognisable, ${feel ? expression : 'natural expression that fits the moment'}.`,
    'Replace the background, wardrobe and lighting to match this scene (the location described below is required):',
    String(scenePrompt || '').slice(0, 2400),
    'Real skin texture with pores, natural catchlights, shot on a cinema camera, 35mm lens, shallow depth of field.',
    textRule(signWords(scenePrompt)),
    'No watermark, no captions, no extra people in focus, no plastic or airbrushed skin, no distorted hands.',
    SAFETY_RULE,
  ].filter(Boolean).join(' ');
}

/** Motion prompt for animating the first frame. */
export function likenessMotionPrompt(scenePrompt) {
  return [
    String(scenePrompt || '').slice(0, 1100),
    "Keep the person's face and identity exactly as in the first frame for the whole shot:",
    'same eyes, nose, mouth, jawline, skin tone, facial hair and eyewear in every frame.',
    'Natural, unhurried human motion, the face stays sharp and in focus,',
    'no face morphing, no warping, no melting, no extra or missing teeth, no flicker.',
    TEXT_MOTION_RULE,
    SAFETY_RULE,
  ].join(' ');
}

/**
 * Automatic face check: compares the person's photo with a generated first
 * frame and rejects identity drift or malformed features before any video is
 * made. If the checker itself is unavailable the frame is allowed (logged).
 */
export async function checkFace({ photoUrl, frameUrl }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) { console.warn('face check skipped: no OPENAI_API_KEY'); return { ok: true, skipped: true }; }
  try {
    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: FACE_CHECK_MODEL,
        reasoning: { effort: 'low' },
        max_output_tokens: 1500,
        input: [{
          role: 'user',
          content: [
            { type: 'input_text', text: `Image 1 is a reference photo of a real person. Image 2 is a generated film still that must show the SAME person. Judge strictly as a casting director would. same_person: would friends instantly recognise them as the same individual (face shape, eyes, nose, lips, skin tone, facial hair, hairline)? Wardrobe, background, lighting and expression may differ. malformed: any distorted, asymmetric, melted or extra facial features, warped eyes, broken teeth, or extra/missing fingers on visible hands. ${TEXT_CHECK}` },
            { type: 'input_image', image_url: photoUrl, detail: 'high' },
            { type: 'input_image', image_url: frameUrl, detail: 'high' },
          ],
        }],
        text: { format: { type: 'json_schema', name: 'face_check', strict: true, schema: {
          type: 'object', additionalProperties: false,
          properties: { same_person: { type: 'boolean' }, malformed: { type: 'boolean' }, text_ok: { type: 'boolean' }, text_issue: { type: 'string' }, words: WORDS_SCHEMA, reason: { type: 'string' } },
          required: ['same_person', 'malformed', 'text_ok', 'text_issue', 'words', 'reason'],
        } } },
      }),
    });
    if (!res.ok) { console.warn('face check unavailable', res.status); return { ok: true, skipped: true }; }
    const data = await res.json();
    const text = data.output_text || data.output?.flatMap((o) => o.content || []).find((c) => c.type === 'output_text')?.text;
    const verdict = JSON.parse(text || '{}');
    const faceOk = verdict.same_person === true && verdict.malformed === false;
    const { textOk, textIssue } = textVerdict(verdict);
    return { ok: faceOk && textOk, faceOk, textOk, textIssue, reason: String(verdict.reason || '').slice(0, 200) };
  } catch (error) {
    console.warn('face check failed to run', error?.message);
    return { ok: true, skipped: true };
  }
}

/** Prompt for a still of a scene without a real face. */
export function stillPrompt(scenePrompt) {
  return [
    'Photorealistic cinematic film still, the first frame of this shot:',
    String(scenePrompt || '').slice(0, 1800),
    'Real people with natural skin texture and pores, natural light and catchlights, shot on a cinema camera, shallow depth of field.',
    textRule(signWords(scenePrompt)),
    'No watermark, no captions, no distorted faces or hands, no plastic or airbrushed skin.',
    SAFETY_RULE,
  ].join(' ');
}

/**
 * Performance prompt for the one-step singing model. The model rejects long
 * text, so this stays short (well under 150 characters); the lyrics come
 * from the audio itself.
 */
export const PERFORM_PROMPT_MAX = 150;
const PERFORM_BASE = 'Sings with emotion, natural lip sync, real expressions, blinking and subtle head moves. Face stays exactly the same.';
/** Fixed, short direction (the singing model rejects long text). */
export function performPrompt(feeling = '') {
  const words = String(feeling || '').trim();
  const text = words
    ? `Sings ${words}. Natural lip sync, real expressions, blinking, subtle head moves. Face stays exactly the same.`
    : PERFORM_BASE;
  return text.length <= 130 ? text : PERFORM_BASE;
}

// Stills normally take 20-60 s, but Nano Banana sometimes needs 2-3 minutes
// under load (two production stills timed out at 120 s on 2026-10-20 and
// were refunded while MUAPI still billed them). Wait up to 4 minutes.
export const STILL_POLL_TIMEOUT_MS = 240_000;

async function pollResult(base, apiKey, requestId, { timeoutMs = STILL_POLL_TIMEOUT_MS, intervalMs = Number(process.env.MUAPI_POLL_MS) || 2500 } = {}) {
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

/** Run a text-to-image still and return its URL. */
export async function makeStill({ base, apiKey, scenePrompt, aspectRatio, check = checkStill }) {
  // Two tries at most: the second names the bad writing or anatomy to fix.
  let prompt = scenePrompt;
  let last = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const url = await submitStill({ base, apiKey, scenePrompt: prompt, aspectRatio });
    const verdict = await check({ frameUrl: url });
    if (verdict.ok) return url;
    last = verdict;
    console.warn('still check rejected', { attempt, text: verdict.textIssue, reason: verdict.reason });
    prompt = `${scenePrompt} ${verdict.textOk === false ? textFix(scenePrompt, verdict.textIssue) : `IMPORTANT: fix this: ${verdict.reason}`}`;
  }
  throw new StillQualityError(last?.textIssue || last?.reason);
}

// Backups when the first model fails or times out (MUAPI image leaderboard,
// 7 days to 2026-10-20): real-face stills Nano Banana 2 Edit 96.3% of 6,794
// -> Seedream 4.5 Edit 99% of 4,149 ($0.05, cheaper); scenery stills
// FLUX Krea 100% -> Nano Banana 96.4% ($0.03). Same price to the customer.
export const KEYFRAME_FALLBACK_MODEL = 'bytedance-seedream-v4.5-edit';
export const STILL_FALLBACK_MODEL = 'nano-banana';
const ASPECTS = ['16:9', '9:16', '1:1', '21:9', '4:3', '3:4'];

async function submitAndPoll({ base, apiKey, model, body, label }) {
  const res = await fetch(`${base}/api/v1/${model}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`${label} rejected`, { model, status: res.status, response: text.slice(0, 300) });
    throw new Error(`${label} rejected (${res.status})`);
  }
  let data = null;
  try { data = JSON.parse(text); } catch { data = null; }
  const id = data?.request_id || data?.id || data?.data?.request_id;
  if (!id) throw new Error(`${label} returned no job id`);
  return pollResult(base, apiKey, id);
}

/** Try the main model; if it fails or times out, the backup with the same inputs. */
async function withFallback(primary, fallback, label) {
  try {
    return await primary();
  } catch (error) {
    console.warn(`${label} failed on the main model, trying the backup`, { error: String(error?.message || error).slice(0, 200) });
    return fallback();
  }
}

async function submitStillPrimary({ base, apiKey, scenePrompt, aspectRatio }) {
  const res = await fetch(`${base}/api/v1/${STILL_MODEL}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({
      prompt: stillPrompt(scenePrompt),
      aspect_ratio: ['16:9', '9:16', '1:1', '21:9', '4:3', '3:4'].includes(aspectRatio) ? aspectRatio : '16:9',
      num_images: 1,
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error('still rejected', { status: res.status, response: text.slice(0, 300) });
    throw new Error(`still rejected (${res.status})`);
  }
  let data = null;
  try { data = JSON.parse(text); } catch { data = null; }
  const id = data?.request_id || data?.id || data?.data?.request_id;
  if (!id) throw new Error('still returned no job id');
  return pollResult(base, apiKey, id);
}

function submitStill(args) {
  const { base, apiKey, scenePrompt, aspectRatio } = args;
  return withFallback(
    () => submitStillPrimary(args),
    () => submitAndPoll({ base, apiKey, model: STILL_FALLBACK_MODEL, label: 'still', body: { prompt: stillPrompt(scenePrompt), aspect_ratio: ASPECTS.includes(aspectRatio) ? aspectRatio : '16:9' } }),
    'still'
  );
}

async function submitKeyframePrimary({ base, apiKey, photoUrl, prompt, aspectRatio, resolution }) {
  const res = await fetch(`${base}/api/v1/${KEYFRAME_MODEL}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({
      images_list: [photoUrl],
      prompt,
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

function submitKeyframe(args) {
  const { base, apiKey, photoUrl, prompt, aspectRatio } = args;
  return withFallback(
    () => submitKeyframePrimary(args),
    () => submitAndPoll({ base, apiKey, model: KEYFRAME_FALLBACK_MODEL, label: 'first frame', body: { images_list: [photoUrl], prompt, aspect_ratio: ASPECTS.includes(aspectRatio) ? aspectRatio : '16:9' } }),
    'first frame'
  );
}

/**
 * Make the first frame, check the face against the photo, and retry once
 * with a stricter instruction if it drifted. Throws FaceMismatchError if the
 * face still isn't right, so nothing is animated and the job is refunded.
 */
export async function makeKeyframe({ base, apiKey, asset, scenePrompt, aspectRatio, resolution, singing = false, shotDirection = '', check = checkFace, signedPhotoUrl = null }) {
  const photoUrl = signedPhotoUrl || await (await import('../cinexvideo-server.js')).createSignedDownloadUrl(LIKENESS_BUCKET, asset.storage_path, 1800);
  if (!photoUrl) throw new Error('singer photo unavailable');
  let prompt = keyframePrompt(scenePrompt, { name: asset.name, notes: asset.notes, singing, shotDirection });
  let last = '';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const frameUrl = await submitKeyframe({ base, apiKey, photoUrl, prompt, aspectRatio, resolution });
    const verdict = await check({ photoUrl, frameUrl });
    if (verdict.ok) return frameUrl;
    last = verdict;
    console.warn('quality check rejected first frame', { asset: asset.id, attempt, reason: verdict.reason, text: verdict.textIssue });
    const faceBad = verdict.faceOk === false || verdict.faceOk === undefined;
    prompt = `${prompt} ${faceBad ? `IMPORTANT: the face must be an exact match of the reference photo; do not beautify, slim, age, or restyle the face. ${verdict.reason ? `Fix: ${verdict.reason}` : ''}` : ''} ${verdict.textOk === false ? textFix(scenePrompt, verdict.textIssue) : ''}`.replace(/\s+/g, ' ').slice(0, 4000);
  }
  if (last && last.faceOk === true && last.textOk === false) throw new StillQualityError(last.textIssue);
  throw new FaceMismatchError(last?.reason || 'face did not match the photo');
}
