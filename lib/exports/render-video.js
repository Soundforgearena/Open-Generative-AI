// Finished-video renderer.
//
// Joins each scene's chosen take in order, lays the project's soundtrack under
// it when one was uploaded, and burns in the CineXVideo watermark: the logo in
// the top-right corner and the app name in the bottom-right corner. The result
// is a single MP4 (H.264 + AAC, fast-start) that plays everywhere and uploads
// cleanly to TikTok, YouTube, Instagram and Reels.
//
// Files live in a private temp folder only while the render runs and the
// download streams; nothing is kept in cloud storage.

import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, stat, statfs, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const MAX_INPUT_BYTES = 600 * 1024 * 1024;
const MAX_TOTAL_SECONDS = 15 * 60;
const RENDER_TIMEOUT_MS = 12 * 60 * 1000;
const ROOT = path.join(tmpdir(), 'cinex-renders');
// Never let renders fill the server disk: refuse to start below this much
// free space, and every render deletes its files as soon as it is delivered.
const MIN_FREE_BYTES = (Number(process.env.RENDER_MIN_FREE_MB) || 2048) * 1024 * 1024;

export class RenderDiskError extends Error {}

async function freeBytes(dir) {
  try {
    const s = await statfs(dir);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return Infinity; // statfs unsupported: rely on the other limits
  }
}

/* --------------------------------------------------------- concurrency */

// Rendering is CPU heavy. Each server runs a few at a time and queues the
// rest, so a rush of exports slows down gracefully instead of crashing.
const MAX_CONCURRENT = Math.max(1, Number(process.env.RENDER_CONCURRENCY) || 2);
const MAX_QUEUED = Math.max(1, Number(process.env.RENDER_QUEUE_LIMIT) || 12);
let running = 0;
const waiting = [];

export function renderQueueState() {
  return { running, queued: waiting.length, capacity: MAX_CONCURRENT, queueLimit: MAX_QUEUED };
}

export class RenderBusyError extends Error {}

async function acquire() {
  if (running < MAX_CONCURRENT) { running += 1; return; }
  if (waiting.length >= MAX_QUEUED) throw new RenderBusyError('The render queue is full.');
  await new Promise((resolve) => waiting.push(resolve));
  running += 1;
}

function release() {
  running -= 1;
  const next = waiting.shift();
  if (next) next();
}

/* -------------------------------------------------------------- helpers */

export function isFetchableMediaUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return false;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':') || host.startsWith('[')) return false;
    return true;
  } catch {
    return false;
  }
}

export function safeFileName(title, ext = 'mp4') {
  const base = String(title || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100) || 'CineXVideo';
  return `${base}.${ext}`;
}

function run(cmd, args, { timeoutMs = RENDER_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`${cmd} exited ${code}: ${err.split('\n').slice(-6).join(' | ')}`));
    });
  });
}

async function download(url, file) {
  if (!isFetchableMediaUrl(url)) throw new Error('unsupported media url');
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`media fetch failed (${res.status})`);
  const length = Number(res.headers.get('content-length') || 0);
  if (length > MAX_INPUT_BYTES) throw new Error('media file too large');
  let seen = 0;
  const limited = Readable.fromWeb(res.body).on('data', (chunk) => {
    seen += chunk.length;
    if (seen > MAX_INPUT_BYTES) limited.destroy(new Error('media file too large'));
  });
  await pipeline(limited, createWriteStream(file));
}

async function probe(file) {
  const json = JSON.parse(await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file], { timeoutMs: 60_000 }));
  const video = json.streams?.find((s) => s.codec_type === 'video');
  const audio = json.streams?.find((s) => s.codec_type === 'audio');
  const duration = Number(json.format?.duration || video?.duration || 0);
  return { width: Number(video?.width || 0), height: Number(video?.height || 0), duration, hasVideo: Boolean(video), hasAudio: Boolean(audio) };
}

const even = (n) => Math.max(2, Math.round(n / 2) * 2);

/** Output frame size: the first clip's shape, capped at 1080p on the short side. */
export function outputSize(clips) {
  const first = clips.find((c) => c.width && c.height) || { width: 1280, height: 720 };
  const short = Math.min(first.width, first.height);
  const scale = short > 1080 ? 1080 / short : 1;
  return { width: even(first.width * scale), height: even(first.height * scale) };
}

/** Watermark placement in pixels for a given frame size. */
export function watermarkLayout({ width, height }) {
  const short = Math.min(width, height);
  const margin = even(short * 0.035);
  // Sized to read clearly on a phone yet stay small enough, and translucent
  // enough, that it never competes with the picture: corner placement keeps
  // faces and action (which sit centre frame) completely clear.
  return {
    margin,
    logoHeight: even(short * 0.075),
    wordmarkWidth: even(Math.min(width * 0.2, short * 0.34)),
    opacity: 0.82,
  };
}

/** Builds the ffmpeg filter graph. Exported for tests. */
export function buildFilterGraph({ clips, size, soundtrackIndex = null, logoIndex, wordmarkIndex, silenceIndexes = {}, watermark = true }) {
  const { width: W, height: H } = size;
  const total = clips.reduce((sum, c) => sum + c.duration, 0);
  const lay = watermarkLayout(size);
  const parts = [];
  clips.forEach((clip, i) => {
    parts.push(
      `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,fps=30,setsar=1,format=yuv420p,trim=duration=${clip.duration.toFixed(3)},setpts=PTS-STARTPTS[v${i}]`
    );
    const audioIn = clip.hasAudio ? `[${i}:a]` : `[${silenceIndexes[i]}:a]`;
    parts.push(`${audioIn}aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=duration=${clip.duration.toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`);
  });
  parts.push(`${clips.map((_, i) => `[v${i}][a${i}]`).join('')}concat=n=${clips.length}:v=1:a=1[base][clipaudio]`);
  if (!watermark) {
    parts.push('[base]format=yuv420p[vout]');
  } else {
  parts.push(`[${logoIndex}:v]scale=-2:${lay.logoHeight}:flags=lanczos,format=rgba,colorchannelmixer=aa=${lay.opacity}[logo]`);
  parts.push(`[${wordmarkIndex}:v]scale=${lay.wordmarkWidth}:-2:flags=lanczos,format=rgba,colorchannelmixer=aa=${lay.opacity}[word]`);
  parts.push(`[base][logo]overlay=x=W-w-${lay.margin}:y=${lay.margin}[v1]`);
  parts.push(`[v1][word]overlay=x=W-w-${lay.margin}:y=H-h-${lay.margin},format=yuv420p[vout]`);
  }
  if (soundtrackIndex !== null) {
    const fade = Math.min(2, total / 4);
    parts.push(`[${soundtrackIndex}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=duration=${total.toFixed(3)},afade=t=out:st=${Math.max(0, total - fade).toFixed(3)}:d=${fade.toFixed(3)}[aout]`);
    parts.push('[clipaudio]anullsink');
  } else {
    parts.push('[clipaudio]anull[aout]');
  }
  return parts.join(';');
}

async function sweepStale() {
  try {
    const entries = await readdir(ROOT);
    const cutoff = Date.now() - 60 * 60 * 1000;
    await Promise.all(entries.map(async (name) => {
      const dir = path.join(ROOT, name);
      const info = await stat(dir).catch(() => null);
      if (info && info.mtimeMs < cutoff) await rm(dir, { recursive: true, force: true });
    }));
  } catch { /* first run */ }
}

/**
 * Render the finished video. Returns { file, size, cleanup }.
 * `takes` = [{ url }] in scene order; `soundtrackUrl` optional.
 */
export async function renderFinishedVideo({ takes, soundtrackUrl = null, watermark = true, assetsDir = path.join(process.cwd(), 'public', 'watermark') }) {
  if (!takes?.length) throw new Error('no takes to render');
  await acquire();
  let dir;
  try {
    await mkdir(ROOT, { recursive: true });
    await sweepStale();
    if ((await freeBytes(ROOT)) < MIN_FREE_BYTES) throw new RenderDiskError('Not enough free disk space to render right now.');
    dir = await mkdtemp(path.join(ROOT, 'job-'));
  } catch (error) {
    release();
    throw error;
  }
  const cleanup = () => rm(dir, { recursive: true, force: true }).catch(() => {});
  try {
    const clips = [];
    for (let i = 0; i < takes.length; i += 1) {
      let file = path.join(dir, `clip-${i}`);
      // `localFile` is only used by tests; real takes are always fetched.
      if (takes[i].localFile) file = takes[i].localFile;
      else await download(takes[i].url, file);
      const info = await probe(file);
      if (!info.hasVideo || !(info.duration > 0)) throw new Error(`scene ${i + 1} has no playable video`);
      clips.push({ file, ...info });
    }
    const total = clips.reduce((sum, c) => sum + c.duration, 0);
    if (total > MAX_TOTAL_SECONDS) throw new Error('video is too long to render');

    let soundtrack = null;
    if (soundtrackUrl) {
      soundtrack = path.join(dir, 'soundtrack');
      try { await download(soundtrackUrl, soundtrack); } catch { soundtrack = null; }
    }

    const size = outputSize(clips);
    const args = ['-hide_banner', '-loglevel', 'error', '-y'];
    clips.forEach((clip) => args.push('-i', clip.file));
    let next = clips.length;
    const silenceIndexes = {};
    clips.forEach((clip, i) => {
      if (!clip.hasAudio) {
        args.push('-f', 'lavfi', '-t', clip.duration.toFixed(3), '-i', 'anullsrc=r=48000:cl=stereo');
        silenceIndexes[i] = next; next += 1;
      }
    });
    let soundtrackIndex = null;
    if (soundtrack) { args.push('-i', soundtrack); soundtrackIndex = next; next += 1; }
    let logoIndex = null;
    let wordmarkIndex = null;
    if (watermark) {
      args.push('-i', path.join(assetsDir, 'logo.png')); logoIndex = next; next += 1;
      args.push('-i', path.join(assetsDir, 'wordmark.png')); wordmarkIndex = next; next += 1;
    }

    const graph = buildFilterGraph({ clips, size, soundtrackIndex, logoIndex, wordmarkIndex, silenceIndexes, watermark });
    const output = path.join(dir, 'final.mp4');
    args.push(
      '-filter_complex', graph,
      '-map', '[vout]', '-map', '[aout]',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '192k',
      '-movflags', '+faststart',
      '-metadata', 'comment=Made with CineXVideo',
      '-metadata', 'title=CineXVideo',
      '-threads', String(Number(process.env.RENDER_THREADS) || 2),
      output
    );
    await run('ffmpeg', args);
    // Free the inputs right away; only the finished file waits for download.
    await Promise.all([
      ...clips.filter((c) => c.file.startsWith(dir)).map((c) => unlink(c.file).catch(() => {})),
      soundtrack ? unlink(soundtrack).catch(() => {}) : null,
    ]);
    const info = await stat(output);
    return { file: output, size: info.size, duration: total, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  } finally {
    release();
  }
}
