// Pulls a few frames from a finished take so they can be moderated before the
// take is charged or shown. Frames stay in memory (never written to disk).

import { spawn } from 'node:child_process';

function run(cmd, args, { timeoutMs = 30_000, binary = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const out = [];
    let err = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`${cmd} timed out`)); }, timeoutMs);
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`${cmd} failed: ${err.slice(-200)}`));
      const buf = Buffer.concat(out);
      resolve(binary ? buf : buf.toString());
    });
  });
}

/** Start, middle and end of the clip (as fractions), clear of fades. */
export function frameTimes(duration) {
  const d = Number(duration);
  if (!(d > 0)) return [0.5];
  return [0.08, 0.5, 0.92].map((f) => Math.round(d * f * 100) / 100);
}

/** Returns JPEG data URLs (512 px wide) for moderation. */
export async function takeFrames(url, { runImpl = run } = {}) {
  const probe = await runImpl('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', url], { timeoutMs: 20_000 });
  const times = frameTimes(parseFloat(String(probe).trim()));
  const frames = await Promise.all(times.map((t) => runImpl('ffmpeg', [
    '-v', 'error', '-ss', String(t), '-i', url, '-frames:v', '1', '-vf', 'scale=512:-2',
    '-f', 'image2pipe', '-vcodec', 'mjpeg', '-q:v', '4', 'pipe:1',
  ], { timeoutMs: 30_000, binary: true })));
  return frames.filter((b) => b && b.length > 500).map((b) => `data:image/jpeg;base64,${Buffer.from(b).toString('base64')}`);
}
