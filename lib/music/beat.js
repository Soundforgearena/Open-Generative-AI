// Tempo of a song, measured from the audio itself (no external service).
// Onset strength = rise in short-time energy per frequency-ish band, then an
// autocorrelation picks the strongest beat period between 70 and 180 BPM.

const SR = 11025;
const HOP = 256;

/** Estimate BPM (and first-beat offset) from mono float32 PCM at 11025 Hz. */
const N = 1024;

function fftMag(re, im) {
  // In-place iterative radix-2 FFT; returns nothing (re/im overwritten).
  for (let i = 1, j = 0; i < N; i += 1) {
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= N; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang); const wi = Math.sin(ang);
    for (let i = 0; i < N; i += len) {
      let cr = 1; let ci = 0;
      for (let k = 0; k < len / 2; k += 1) {
        const a = i + k; const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci; const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

/** Estimate BPM (and first-beat offset) from mono float32 PCM at 11025 Hz. */
export function estimateTempo(pcm) {
  const frames = Math.floor((pcm.length - N) / HOP);
  if (frames < 64) return null;
  // Onset strength: spectral flux of the log-magnitude spectrum.
  const win = new Float32Array(N).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
  const env = new Float32Array(frames);
  let prev = new Float32Array(N / 2);
  const re = new Float64Array(N); const im = new Float64Array(N);
  for (let f = 0; f < frames; f += 1) {
    const o = f * HOP;
    for (let i = 0; i < N; i += 1) { re[i] = pcm[o + i] * win[i]; im[i] = 0; }
    fftMag(re, im);
    const cur = new Float32Array(N / 2);
    let flux = 0;
    for (let k = 1; k < N / 2; k += 1) {
      cur[k] = Math.log1p(Math.hypot(re[k], im[k]));
      const d = cur[k] - prev[k];
      if (d > 0) flux += d;
    }
    env[f] = f === 0 ? 0 : flux;
    prev = cur;
  }
  let mean = 0; for (const v of env) mean += v; mean /= frames;
  for (let f = 0; f < frames; f += 1) env[f] -= mean;
  const fps = SR / HOP;
  let best = { score: -Infinity, bpm: null };
  for (let bpm = 70; bpm <= 180; bpm += 0.1) {
    // Score the beat period and its multiples (1-4 beats ahead): sharper
    // than one lag alone, and keeps sub-frame precision.
    let s = 0;
    for (let m = 1; m <= 4; m += 1) {
      const lag = ((60 * m) / bpm) * fps;
      const l0 = Math.floor(lag); const w = lag - l0;
      let acc = 0;
      for (let f = 0; f + l0 + 1 < frames; f += 1) acc += env[f] * ((1 - w) * env[f + l0] + w * env[f + l0 + 1]);
      s += acc / (frames - l0);
    }
    // Mild preference for the 90-140 BPM range most dance music sits in.
    const prior = Math.exp(-((Math.log2(bpm / 115)) ** 2) / 0.5);
    if (s * prior > best.score) best = { score: s * prior, bpm };
  }
  if (!best.bpm) return null;
  const period = (60 / best.bpm) * fps;
  let phase = { score: -Infinity, offset: 0 };
  for (let o = 0; o < period; o += 1) {
    let s = 0;
    for (let t = o; t < frames; t += period) s += env[Math.round(t)] || 0;
    if (s > phase.score) phase = { score: s, offset: o };
  }
  return { bpm: Math.round(best.bpm * 10) / 10, firstBeatMs: Math.round((phase.offset / fps) * 1000) };
}

export const TEMPO_SAMPLE_RATE = SR;
