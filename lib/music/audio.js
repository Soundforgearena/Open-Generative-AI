// Server-side song helpers: find the project's track, measure it, and cut the
// exact slice a lip-synced scene needs. Temp files are deleted immediately;
// each scene keeps at most one small slice in storage (overwritten on retry).

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createSignedDownloadUrl,
  selectRows,
  uploadStorageObject,
} from '../cinexvideo-server.js';
import { download, probe, run } from '../exports/render-video.js';

export const SONG_BUCKET = 'cinexvideo-references';
const MAX_SLICE_BYTES = 9 * 1024 * 1024; // provider accepts up to 10 MB

/** The newest audio upload for a project, or null. */
export async function projectSong(projectId) {
  const rows = await selectRows(
    'project_assets',
    { project_id: `eq.${projectId}`, kind: 'eq.audio', storage_path: 'not.is.null', order: 'created_at.desc', limit: '1' },
    'id,name,storage_path,created_at'
  );
  return rows[0] || null;
}

export async function songUrl(song, expiresIn = 3600) {
  return song?.storage_path ? createSignedDownloadUrl(SONG_BUCKET, song.storage_path, expiresIn) : null;
}

async function withTemp(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), 'cinex-song-'));
  try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true }).catch(() => {}); }
}

/** Download the song and return { file buffer, duration_ms } via callback. */
export async function withSongFile(song, fn) {
  const url = await songUrl(song, 900);
  if (!url) throw new Error('song unavailable');
  return withTemp(async (dir) => {
    const file = path.join(dir, 'song');
    await download(url, file);
    const info = await probe(file);
    const durationMs = Math.round(Number(info.duration) * 1000);
    if (!(durationMs > 0)) throw new Error('song has no playable audio');
    return fn({ file, dir, durationMs });
  });
}

/**
 * Cut [startMs, endMs) from the song as MP3, upload it to a fixed per-scene
 * path and return a signed URL the provider can fetch. Accurate to the
 * millisecond: the seek happens after decoding (-ss after -i).
 */
export async function sliceSongForScene({ song, sceneId, ownerId, projectId, startMs, endMs, minMs = 0 }) {
  return withSongFile(song, async ({ file, dir, durationMs }) => {
    const start = Math.max(0, Math.min(startMs, durationMs - 1));
    // Some models need a minimum amount of audio. Extra time is added only at
    // the end (the song keeps playing, then silence), so the start stays in
    // sync; the export trims every clip back to its exact window.
    const end = Math.max(start + 1, Math.min(endMs, durationMs), start + Math.max(0, Number(minMs) || 0));
    const out = path.join(dir, 'slice.mp3');
    await run('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', file,
      '-ss', (start / 1000).toFixed(3),
      '-t', ((end - start) / 1000).toFixed(3),
      '-vn', ...(minMs ? ['-af', `apad=whole_dur=${(end / 1000).toFixed(3)}`] : []), // filter time counts from the song start
      '-ac', '2', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '192k',
      out,
    ], { timeoutMs: 120_000 });
    const body = await readFile(out);
    if (body.length > MAX_SLICE_BYTES) throw new Error('song slice too large');
    const storagePath = `${ownerId}/${projectId}/lipsync/${sceneId}.mp3`;
    const ok = await uploadStorageObject(SONG_BUCKET, storagePath, body, 'audio/mpeg');
    if (!ok) throw new Error('slice upload failed');
    const url = await createSignedDownloadUrl(SONG_BUCKET, storagePath, 6 * 3600);
    if (!url) throw new Error('slice url failed');
    return { url, durationMs: end - start, storagePath };
  });
}
