// Real provider (MUAPI) costs, so every quote is built on what a job actually
// costs us. Video models bill per second and by resolution; a flat per-job
// cost would under-price long or high-resolution scenes and lose money.
//
// Source: https://muapi.ai/playground/pixverse-v6-t2v (checked 2026-10-02):
// $0.033/s at 360p, $0.059/s at 720p (default), up to $0.150/s at 1080p with
// audio. 540p/1080p without audio follow PixVerse's published unit ratios
// (360p 5, 540p 7, 720p 9, 1080p 18 units per second), rounded up.

export const PROVIDER_PRICING_CHECKED = '2026-10-02';

/** US cents per second of generated video, by resolution (no audio). */
export const PER_SECOND_VIDEO_CENTS = Object.freeze({
  'pixverse-v6-t2v': { '360p': 3.3, '540p': 4.7, '720p': 5.9, '1080p': 11.9 },
  'pixverse-v6-i2v': { '360p': 3.3, '540p': 4.7, '720p': 5.9, '1080p': 11.9 },
});

const MODEL_ALIASES = Object.freeze({ 'pixverse-v6': 'pixverse-v6-t2v' });
const DEFAULT_RESOLUTION = '720p';

function perSecondTable(model) {
  return PER_SECOND_VIDEO_CENTS[MODEL_ALIASES[model] || model] || null;
}

/** Most expensive tier for an unknown resolution, so we never under-charge. */
function rateFor(table, resolution) {
  const key = String(resolution || DEFAULT_RESOLUTION).toLowerCase();
  return table[key] ?? Math.max(...Object.values(table));
}

/**
 * Provider cost in US cents for one job. Per-second models multiply by
 * duration; everything else uses the configured per-job cost. The configured
 * rule cost is always a floor.
 */
export function providerCostCents({ model, operation, durationSeconds = 1, resolution = null, ruleCostCents = 0 }) {
  const floor = Math.max(0, Number(ruleCostCents) || 0);
  const table = operation === 'video' ? perSecondTable(model) : null;
  if (!table) return floor;
  const seconds = Math.max(1, Math.ceil(Number(durationSeconds) || 1));
  const cost = rateFor(table, resolution) * seconds;
  return Math.round(Math.max(floor, cost) * 10000) / 10000;
}
