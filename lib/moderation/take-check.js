// Checks a finished take (three frames) once per job before it is charged or
// shown. Concurrent polls of the same job wait instead of checking twice.

import { moderate } from './moderate.js';
import { takeFrames } from './frames.js';

const results = new Map(); // job id -> { at, verdict }
const inFlight = new Set();
const KEEP_MS = 30 * 60_000;

export async function checkTakeOnce(jobId, url, { frames = takeFrames, check = moderate, now = () => Date.now() } = {}) {
  const hit = results.get(jobId);
  if (hit && now() - hit.at < KEEP_MS) return hit.verdict;
  if (inFlight.has(jobId)) return { pending: true };
  inFlight.add(jobId);
  try {
    let verdict;
    try {
      const imageUrls = await frames(url);
      verdict = imageUrls.length ? await check({ imageUrls }) : { allowed: true, unchecked: true, reason: 'no_frames', categories: [], labels: [], top: {} };
    } catch (error) {
      verdict = { allowed: true, unchecked: true, reason: 'frames_failed', categories: [], labels: [], top: {} };
      console.error('take frames failed', error?.message);
    }
    results.set(jobId, { at: now(), verdict });
    for (const [k, v] of results) if (now() - v.at > KEEP_MS) results.delete(k);
    return verdict;
  } finally {
    inFlight.delete(jobId);
  }
}
