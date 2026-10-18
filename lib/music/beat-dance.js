// Beat-synced dance shots, made automatically from the song: no uploads.
// The approved still (the scene's first frame) plus the scene's exact slice
// of the song go to Seedance 2 Omni Reference (Fast), which times the moves
// to the audio. The measured tempo is written into the direction too, so
// steps, bounces and claps land on the beat.

import { REALISM } from './lyrics.js';

export const BEAT_DANCE_MODEL = 'seedance-2-omni-reference-no-video-fast';
export const BEAT_DANCE_MIN_WINDOW_MS = 3_000; // shorter shots use ordinary motion
export const BEAT_DANCE_MIN_SECONDS = 4; // provider minimum
export const BEAT_DANCE_MAX_SECONDS = 15; // provider maximum (and audio cap)
const DANCE_RE = /\bdanc|\bgroov|\bmoves?\b|\bstep(s|ping)?\b|\bfeet\b|\bfootwork|\bclap|\bbounc|\bwhine|\bwine\b|\bskank|\bshuffl|\btwerk|\bdance ?floor|\bcarnival/i;

/** A non-sung scene whose direction is about dancing. */
export function isDanceScene(scene) {
  if (!scene || scene.lip_sync) return false;
  return DANCE_RE.test(`${scene.prompt || ''} ${scene.purpose || ''} ${scene.title || ''}`);
}

/**
 * Whether a scene is made as a beat-synced dance shot.
 * mode: 'auto' (dance scenes only), 'on' (any non-sung scene), 'off'.
 */
export function beatDanceFor(scene, mode = 'auto') {
  if (!scene || scene.lip_sync || mode === 'off') return null;
  if (mode !== 'on' && !isDanceScene(scene)) return null;
  const windowMs = scene.start_ms !== null && scene.end_ms !== null && scene.start_ms !== undefined
    ? Number(scene.end_ms) - Number(scene.start_ms)
    : Math.round(Number(scene.duration_seconds || 0) * 1000);
  if (!(windowMs >= BEAT_DANCE_MIN_WINDOW_MS) || windowMs > BEAT_DANCE_MAX_SECONDS * 1000) return null;
  const seconds = Math.min(BEAT_DANCE_MAX_SECONDS, Math.max(BEAT_DANCE_MIN_SECONDS, Math.ceil(windowMs / 1000)));
  return { windowMs, seconds };
}

export function beatAspect(ratio) {
  return { '16:9': '16:9', '21:9': '16:9', '9:16': '9:16', '4:5': '3:4', '1:1': '4:3' }[ratio] || '16:9';
}

/** Direction for the model. @image1 = the approved still, @audio1 = the song slice. */
export function beatDancePrompt({ scenePrompt = '', bpm = null } = {}) {
  const tempo = bpm ? ` The track is about ${Math.round(bpm)} BPM:` : '';
  const scene = String(scenePrompt || '').replace(/\s+/g, ' ').slice(0, 2400);
  return [
    '@image1 is the exact opening frame: keep every face, body, outfit and the location exactly as shown.',
    `Everyone dances to @audio1.${tempo} every step, bounce, hip roll, head nod and hand clap lands exactly on the beat, with bigger accents on the downbeats and the drops.`,
    'Real dancers with natural weight shifts, bent knees, loose shoulders, confident grooves and genuine smiles and expressions; feet stay planted on the floor between steps.',
    'Any signs and writing stay exactly as in the first frame: sharp, unchanged and correctly spelled.',
    scene ? `Scene: ${scene}` : '',
    REALISM,
  ].filter(Boolean).join(' ').slice(0, 3900);
}
