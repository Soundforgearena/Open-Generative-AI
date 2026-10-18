// How loud and intense each moment of a song is, measured from the audio.
// Pure: takes mono PCM, returns numbers. Used by the Director to decide how
// big a feeling each scene should carry.

const HOP_MS = 100;

/** Loudness (dB RMS) every 100 ms. */
export function loudnessCurve(pcm, sampleRate) {
  const hop = Math.max(1, Math.round((sampleRate * HOP_MS) / 1000));
  const out = new Float32Array(Math.floor(pcm.length / hop));
  for (let f = 0; f < out.length; f += 1) {
    let sum = 0;
    for (let i = f * hop; i < (f + 1) * hop; i += 1) sum += pcm[i] * pcm[i];
    out[f] = 10 * Math.log10(sum / hop + 1e-10);
  }
  return out;
}

/**
 * Energy of each window as a 0-1 percentile of the whole song: 0 = the
 * quietest part, 1 = the loudest. Relative, so mastering level doesn't matter.
 */
export function windowEnergies(curve, windows) {
  if (!curve?.length) return windows.map(() => 0.5);
  const sorted = Array.from(curve).sort((a, b) => a - b);
  const rank = (v) => {
    let lo = 0; let hi = sorted.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < v) lo = mid + 1; else hi = mid; }
    return lo / sorted.length;
  };
  return windows.map(({ start_ms: s, end_ms: e }) => {
    const a = Math.max(0, Math.floor(Number(s) / HOP_MS));
    const b = Math.min(curve.length, Math.max(a + 1, Math.ceil(Number(e) / HOP_MS)));
    if (!(b > a)) return 0.5;
    let sum = 0;
    for (let i = a; i < b; i += 1) sum += curve[i];
    return Math.round(rank(sum / (b - a)) * 100) / 100;
  });
}
