import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildFilterGraph, outputSize, watermarkLayout, isFetchableMediaUrl, safeFileName } from '../lib/exports/render-video.js';
import { chooseTakes } from '../lib/exports/choose-takes.js';
import { pendingJournal } from '../lib/studio/draft-journal.js';
import { hit, resetRateLimits } from '../lib/rate-limit.js';

const clips = [
  { duration: 5, hasAudio: true, width: 1280, height: 720 },
  { duration: 8, hasAudio: false, width: 720, height: 1280 },
];

test('watermarked render puts the logo top-right and the app name bottom-right', () => {
  const graph = buildFilterGraph({ clips, size: { width: 1280, height: 720 }, logoIndex: 3, wordmarkIndex: 4, silenceIndexes: { 1: 2 } });
  assert.match(graph, /\[base\]\[logo\]overlay=x=W-w-\d+:y=\d+\[v1\]/);
  assert.match(graph, /\[v1\]\[word\]overlay=x=W-w-\d+:y=H-h-\d+/);
  assert.match(graph, /colorchannelmixer=aa=0\.82/);
  assert.match(graph, /concat=n=2:v=1:a=1/);
  assert.match(graph, /\[2:a\]aresample/); // silent track fills the clip with no audio
});

test('clean render has no watermark at all', () => {
  const graph = buildFilterGraph({ clips, size: { width: 1280, height: 720 }, watermark: false, silenceIndexes: { 1: 2 } });
  assert.doesNotMatch(graph, /overlay|logo|word/);
  assert.match(graph, /\[base\]format=yuv420p\[vout\]/);
});

test('soundtrack replaces clip audio and fades out at the end', () => {
  const graph = buildFilterGraph({ clips, size: { width: 1280, height: 720 }, soundtrackIndex: 3, logoIndex: 4, wordmarkIndex: 5, silenceIndexes: { 1: 2 } });
  assert.match(graph, /\[3:a\].*atrim=duration=13\.000,afade=t=out/);
  assert.match(graph, /\[clipaudio\]anullsink/);
});

test('watermark stays small and clear of the picture centre', () => {
  const lay = watermarkLayout({ width: 1920, height: 1080 });
  assert.ok(lay.logoHeight <= 1080 * 0.08);
  assert.ok(lay.wordmarkWidth <= 1920 * 0.2);
  assert.ok(lay.opacity >= 0.75 && lay.opacity < 1);
  const vertical = watermarkLayout({ width: 1080, height: 1920 });
  assert.ok(vertical.wordmarkWidth <= 1080 * 0.34);
});

test('output keeps the first clip shape and caps at 1080p', () => {
  assert.deepEqual(outputSize([{ width: 3840, height: 2160 }]), { width: 1920, height: 1080 });
  assert.deepEqual(outputSize([{ width: 720, height: 1280 }]), { width: 720, height: 1280 });
});

test('only public https media is fetched', () => {
  assert.equal(isFetchableMediaUrl('https://cdn.muapi.ai/x.mp4'), true);
  assert.equal(isFetchableMediaUrl('http://cdn.muapi.ai/x.mp4'), false);
  assert.equal(isFetchableMediaUrl('https://169.254.169.254/latest'), false);
  assert.equal(isFetchableMediaUrl('https://localhost/x'), false);
  assert.equal(safeFileName('My: "Video"/1'), 'My Video 1.mp4');
});

test('finished cut uses the approved take, else the newest, and lists unfinished scenes', () => {
  const scenes = [{ id: 'a', position: 1, title: 'Intro' }, { id: 'b', position: 2, title: 'Hook' }, { id: 'c', position: 3, title: 'Outro' }];
  const versions = [
    { id: 'a1', scene_id: 'a', version: 1, output_url: 'https://x/a1', approved: true },
    { id: 'a2', scene_id: 'a', version: 2, output_url: 'https://x/a2', approved: false },
    { id: 'b1', scene_id: 'b', version: 1, output_url: 'https://x/b1' },
    { id: 'b2', scene_id: 'b', version: 2, output_url: 'https://x/b2' },
  ];
  const { takes, missing } = chooseTakes(scenes, versions);
  assert.deepEqual(takes.map((t) => t.version_id), ['a1', 'b2']);
  assert.deepEqual(missing, ['Scene 3 (Outro)']);
});

test('download is only the finished video: no raw take or ZIP downloads exist', () => {
  const studio = readFileSync(new URL('../components/studio/Studio.js', import.meta.url), 'utf8');
  assert.doesNotMatch(studio, /versionId|ZIP/);
  const route = readFileSync(new URL('../app/api/exports/video/route.js', import.meta.url), 'utf8');
  assert.match(route, /reserve_paid_credits_v1/); // removal is paid with purchased credits
  assert.match(route, /release_reservation_v2/); // never charged when the render fails
});

test('refresh journal replays unsaved edits but never overwrites newer server work', () => {
  const store = new Map();
  globalThis.window = { localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) } };
  const at = Date.parse('2026-10-06T12:00:00Z');
  store.set('cinex-studio-draft-v1:p1', JSON.stringify({ at, scenes: { s1: { prompt: 'new' }, s2: { prompt: 'old' }, gone: { prompt: 'x' } }, project: { title: 'T' } }));
  const pending = pendingJournal('p1', [
    { id: 's1', updated_at: '2026-10-06T11:59:00Z' },
    { id: 's2', updated_at: '2026-10-06T12:05:00Z' },
  ], '2026-10-06T11:00:00Z', at + 1000);
  assert.deepEqual(pending.scenes, { s1: { prompt: 'new' } });
  assert.deepEqual(pending.project, { title: 'T' });
  delete globalThis.window;
});

test('rate limiter blocks bursts and recovers after the window', () => {
  resetRateLimits();
  const opts = { limit: 2, windowMs: 1000 };
  assert.equal(hit('k', opts, 0).allowed, true);
  assert.equal(hit('k', opts, 10).allowed, true);
  assert.equal(hit('k', opts, 20).allowed, false);
  assert.equal(hit('k', opts, 1100).allowed, true);
});
