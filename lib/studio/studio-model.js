// Pure helpers for the AI Video Creation Studio. No browser or network access,
// so every rule here is covered by unit tests.

export const SHOT_TYPES = ['Extreme Wide Shot', 'Wide Shot', 'Full Shot', 'Medium Shot', 'Medium Close-Up', 'Close-Up', 'Extreme Close-Up', 'Over-the-Shoulder', 'Point of View', 'Aerial'];
export const MOVEMENTS = ['Static', 'Slow Push In', 'Pull Out', 'Pan Left', 'Pan Right', 'Tilt Up', 'Tilt Down', 'Dolly Track', 'Crane Up', 'Orbit', 'Handheld'];
export const ANGLES = ['Eye Level', 'Slight Low Angle', 'Low Angle', 'High Angle', "Bird's Eye", 'Dutch Angle', "Worm's Eye"];
export const LENSES = ['14mm (ultra wide)', '24mm (wide)', '35mm (cinematic)', '50mm (natural)', '85mm (portrait)', '135mm (telephoto)', '40mm (anamorphic)'];
export const ASPECT_RATIOS = ['16:9', '9:16', '1:1', '4:5', '21:9'];
export const FRAME_RATES = ['24 fps', '25 fps', '30 fps'];
export const RESOLUTIONS = [
  { value: '720p', label: '1280 × 720 (HD)', rank: 720 },
  { value: '1080p', label: '1920 × 1080 (Full HD)', rank: 1080 },
];

export const DEFAULT_CONTROLS = Object.freeze({
  shot: 'Wide Shot',
  movement: 'Slow Push In',
  angle: 'Slight Low Angle',
  lens: '35mm (cinematic)',
  tags: [],
  fps: '24 fps',
  resolution: '720p',
  notes: '',
});

const MARKER = 'cinex-studio:v1';

/** Shot direction is stored as tagged JSON; legacy plain text survives as notes. */
export function parseShotDirection(text) {
  if (typeof text === 'string' && text.startsWith(MARKER)) {
    try {
      const parsed = JSON.parse(text.slice(MARKER.length));
      return { ...DEFAULT_CONTROLS, ...sanitizeControls(parsed) };
    } catch {
      return { ...DEFAULT_CONTROLS };
    }
  }
  return { ...DEFAULT_CONTROLS, notes: typeof text === 'string' ? text.slice(0, 2000) : '' };
}

export function serializeShotDirection(controls) {
  return MARKER + JSON.stringify(sanitizeControls(controls));
}

function pick(list, value, fallback) {
  return list.includes(value) ? value : fallback;
}

export function sanitizeControls(input = {}) {
  return {
    shot: pick(SHOT_TYPES, input.shot, DEFAULT_CONTROLS.shot),
    movement: pick(MOVEMENTS, input.movement, DEFAULT_CONTROLS.movement),
    angle: pick(ANGLES, input.angle, DEFAULT_CONTROLS.angle),
    lens: pick(LENSES, input.lens, DEFAULT_CONTROLS.lens),
    fps: pick(FRAME_RATES, input.fps, DEFAULT_CONTROLS.fps),
    resolution: RESOLUTIONS.some((r) => r.value === input.resolution) ? input.resolution : DEFAULT_CONTROLS.resolution,
    tags: normalizeTags(input.tags),
    notes: typeof input.notes === 'string' ? input.notes.slice(0, 2000) : '',
  };
}

export function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of tags) {
    const tag = String(raw || '').toLowerCase().replace(/[^a-z0-9 \-]/g, '').trim().slice(0, 32);
    if (tag && !seen.has(tag)) { seen.add(tag); out.push(tag); }
    if (out.length >= 12) break;
  }
  return out;
}

/** Resolutions a model supports, capped by the catalog's max_resolution. */
export function resolutionsFor(maxResolution) {
  const cap = Number(String(maxResolution || '720').replace(/\D/g, '')) || 720;
  const allowed = RESOLUTIONS.filter((r) => r.rank <= cap);
  return allowed.length ? allowed : [RESOLUTIONS[0]];
}

/** The exact prompt sent to the provider: story prompt + camera language + style. */
export function buildProviderPrompt({ prompt, controls, style }) {
  const c = sanitizeControls(controls);
  const parts = [String(prompt || '').trim()];
  parts.push(`${c.shot}, ${c.movement.toLowerCase()}, ${c.angle.toLowerCase()}, ${c.lens.replace(/\s*\(.*\)/, '')} lens`);
  if (style) parts.push(String(style).trim());
  if (c.tags.length) parts.push(c.tags.join(', '));
  parts.push(`${c.fps.replace(' fps', 'fps')} film cadence`);
  return parts.filter(Boolean).join('. ').replace(/\.\./g, '.').slice(0, 4800);
}

/** Flight Path health: good, warning, issue, or pending (not generated yet). */
export function sceneHealth(scene) {
  if (!scene) return 'pending';
  if (scene.status === 'failed') return 'issue';
  if (scene.status === 'approved' && scene.continuity_locked) return 'good';
  if (scene.status === 'approved' || scene.status === 'needs_review' || scene.status === 'generating') return 'warning';
  if (scene.continuity_locked) return 'good';
  return 'pending';
}

/** Versions arrive newest-first; preview the newest available take for review. */
export function previewTake(versions = []) {
  return versions.find((version) => version.output_url)
    || versions.find((version) => version.approved)
    || versions[0]
    || null;
}

/** Continuity check between a scene and the next one. */
export function continuityBetween(scene, next) {
  if (!scene || !next) return { state: 'none', label: 'Final scene', matches: [] };
  const a = parseShotDirection(scene.shot_direction);
  const b = parseShotDirection(next.shot_direction);
  const matches = [];
  if (scene.continuity_locked && next.continuity_locked) matches.push('Location', 'Time', 'Character');
  else if (scene.continuity_locked || next.continuity_locked) matches.push('Character');
  if (a.lens === b.lens) matches.push('Lens');
  if (a.fps === b.fps) matches.push('Frame rate');
  const ok = scene.continuity_locked && next.continuity_locked;
  return { state: ok ? 'good' : 'warning', label: ok ? 'Good' : 'Review', matches };
}

export function formatClock(seconds) {
  const safe = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}

/** Deterministic pseudo-waveform for a scene id, so bars never jump between renders. */
export function waveformBars(seed, count = 48) {
  let h = 2166136261;
  for (const ch of String(seed || 'cinex')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const bars = [];
  for (let i = 0; i < count; i += 1) {
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    const n = ((h >>> 0) % 1000) / 1000;
    const envelope = 0.45 + 0.55 * Math.sin((i / count) * Math.PI);
    bars.push(Math.max(0.12, Math.min(1, n * envelope + 0.1)));
  }
  return bars;
}

/** Cumulative start offsets for each scene on the timeline. */
export function timelineOffsets(scenes) {
  let t = 0;
  return scenes.map((scene) => {
    const start = t;
    t += Number(scene.duration_seconds || 0);
    return { id: scene.id, start, end: t };
  });
}
