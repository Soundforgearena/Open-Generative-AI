// Server side of beat-synced dance shots: tempo + the scene's song slice.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createSignedDownloadUrl, uploadStorageObject } from '../cinexvideo-server.js';
import { run } from '../exports/render-video.js';
import { SONG_BUCKET, withSongFile } from './audio.js';
import { estimateTempo, TEMPO_SAMPLE_RATE } from './beat.js';

/**
 * Measure the song's tempo and cut the scene's slice (at least 4 s, at most
 * 15 s: the song keeps playing to fill the minimum). Returns a signed URL.
 */
export async function sliceForBeatDance({ song, sceneId, ownerId, projectId, startMs, seconds }) {
  return withSongFile(song, async ({ file, dir, durationMs }) => {
    const pcmPath = path.join(dir, 'tempo.f32');
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-vn', '-ac', '1', '-ar', String(TEMPO_SAMPLE_RATE), '-f', 'f32le', pcmPath], { timeoutMs: 120_000 });
    const raw = await readFile(pcmPath);
    const pcm = new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.length / 4));
    const tempo = estimateTempo(pcm);

    const lengthMs = seconds * 1000;
    const start = Math.max(0, Math.min(Number(startMs) || 0, Math.max(0, durationMs - 1000)));
    const out = path.join(dir, 'beat.mp3');
    await run('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', file,
      '-ss', (start / 1000).toFixed(3),
      '-t', (lengthMs / 1000).toFixed(3),
      '-vn', '-af', `apad=whole_dur=${((start + lengthMs) / 1000).toFixed(3)}`,
      '-ac', '2', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '192k',
      out,
    ], { timeoutMs: 120_000 });
    const body = await readFile(out);
    const storagePath = `${ownerId}/${projectId}/beat/${sceneId}.mp3`;
    const ok = await uploadStorageObject(SONG_BUCKET, storagePath, body, 'audio/mpeg');
    if (!ok) throw new Error('beat slice upload failed');
    const url = await createSignedDownloadUrl(SONG_BUCKET, storagePath, 6 * 3600);
    if (!url) throw new Error('beat slice url failed');
    return { url, bpm: tempo?.bpm || null, storagePath };
  });
}
