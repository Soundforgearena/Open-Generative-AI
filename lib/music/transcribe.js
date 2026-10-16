// Song transcription tuned for sung vocals over a full mix.
//
// One long request drops whole verses: the recogniser loses the voice under
// drums and bass and silently skips ahead. So the song is (1) cleaned to the
// vocal band and loudness-levelled, then (2) heard in short overlapping
// windows, each one prompted with the lyrics expected there, and (3) stitched
// back together on the song's own clock.

import path from 'node:path';
import { alignLyrics } from './lyrics.js';

export const WINDOW_MS = 30000;
export const STEP_MS = 24000; // 6 s overlap so no word is cut in half
/** Billed audio is ~1.25x the song because of the overlap. */
export const OVERLAP_FACTOR = WINDOW_MS / STEP_MS;

/** Window start/end times covering the whole song. */
export function chunkPlan(durationMs, { windowMs = WINDOW_MS, stepMs = STEP_MS } = {}) {
  const total = Math.max(0, Math.round(Number(durationMs) || 0));
  if (!total) return [];
  if (total <= windowMs) return [{ start: 0, end: total }];
  const plan = [];
  for (let start = 0; start < total; start += stepMs) {
    const end = Math.min(total, start + windowMs);
    plan.push({ start, end });
    if (end >= total) break;
  }
  return plan;
}

/**
 * Keep each word from the window where it sits furthest from an edge, so the
 * overlap never duplicates or drops words.
 */
export function stitchWords(chunks) {
  const out = [];
  chunks.forEach(({ start, end, words }, i) => {
    const prev = chunks[i - 1];
    const next = chunks[i + 1];
    const from = prev ? (start + prev.end) / 2 : -Infinity;
    const to = next ? (next.start + end) / 2 : Infinity;
    for (const w of words || []) {
      const s = start + Number(w.start) * 1000;
      const e = start + Number(w.end) * 1000;
      if (!Number.isFinite(s) || !Number.isFinite(e)) continue;
      const mid = (s + e) / 2;
      if (mid >= from && mid < to) out.push({ word: w.word, start: s / 1000, end: Math.max(s, e) / 1000 });
    }
  });
  return out.sort((a, b) => a.start - b.start);
}

/** Lyrics to prompt the next window with: from the last confidently heard line. */
export function promptFrom(lines, heardWords, durationMs, maxChars = 700) {
  if (!heardWords.length) return lines.map((l) => l.text).join('\n').slice(0, maxChars);
  const timed = alignLyrics(lines, heardWords, durationMs);
  let last = -1;
  timed.forEach((l, i) => { if (l.confidence >= 0.5) last = i; });
  return lines.slice(Math.max(0, last)).map((l) => l.text).join('\n').slice(0, maxChars);
}

/**
 * Clean the mix towards the voice: mono, 16 kHz, vocal band only, levelled.
 * Returns the cleaned file path.
 */
export async function cleanVocals(run, file, dir) {
  const out = path.join(dir, 'vocals.wav');
  await run('ffmpeg', ['-v', 'error', '-y', '-i', file, '-ac', '1', '-ar', '16000',
    '-af', 'highpass=f=120,lowpass=f=6000,dynaudnorm=f=150:g=15',
    '-c:a', 'pcm_s16le', out]);
  return out;
}

async function cutWindow(run, file, dir, { start, end }, i) {
  // 16 kHz mono 16-bit WAV: what the on-server model reads directly
  // (about 1 MB per 30 s window, well inside any upload limit).
  const out = path.join(dir, `w${i}.wav`);
  await run('ffmpeg', ['-v', 'error', '-y', '-i', file, '-ss', (start / 1000).toFixed(3), '-t', ((end - start) / 1000).toFixed(3),
    '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', out]);
  return out;
}

/**
 * Transcribe a song window by window. `hear(windowFile, prompt)` returns
 * words with start/end in seconds relative to the window.
 */
export async function transcribeSong({ run, file, dir, durationMs, lines, hear }) {
  const clean = await cleanVocals(run, file, dir);
  const chunks = [];
  for (const [i, win] of chunkPlan(durationMs).entries()) {
    const part = await cutWindow(run, clean, dir, win, i);
    const prompt = promptFrom(lines, stitchWords(chunks), durationMs);
    const words = await hear(part, prompt);
    chunks.push({ ...win, words });
  }
  return stitchWords(chunks);
}
