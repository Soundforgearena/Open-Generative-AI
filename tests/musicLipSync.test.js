import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { alignLyrics, buildTimeline, parseLyrics, timelineToScenes, tokenize, normalizeTimedLines, MAX_SCENE_MS } from '../lib/music/lyrics.js';
import { planClipTiming, buildFilterGraph } from '../lib/exports/render-video.js';
import { chooseTakes } from '../lib/exports/choose-takes.js';
import { providerCostCents } from '../lib/billing/provider-pricing.js';

const LYRICS = `[ Beat Drop — instant entry ]
Ishy..
OPENING
[ Afro-Canadian]
Everybody was acting normal five seconds ago…
Now look at this place.
HOOK
[ Both — chant ]
Act normal now
[ Ladies — chant response]
Act normal now
[ Jamaican | authentic cadence]
One likkle groove mek di whole place wild
[ Flow Switch]
Look calm`;

test('parses vocalist tags, stage notes and section headings', () => {
  const { lines, cast } = parseLyrics(LYRICS);
  // Two singers; [Both] is the pair together and [Ladies] is a backing chant.
  assert.deepEqual(cast.map((c) => c.key), ['afro-canadian', 'ladies', 'jamaican']);
  assert.deepEqual(cast.filter((c) => c.role === 'singer').map((c) => c.key), ['afro-canadian', 'jamaican']);
  assert.equal(cast.find((c) => c.key === 'ladies').role, 'backing');
  assert.equal(lines.find((l) => l.text === 'Act normal now').vocalist, 'both');
  assert.equal(lines[0].text, 'Ishy..');
  assert.equal(lines[0].vocalist, 'afro-canadian'); // before any tag: first singer
  assert.equal(lines.find((l) => l.text === 'Look calm').vocalist, 'jamaican'); // [Flow Switch] keeps singer
  assert.ok(!lines.some((l) => l.text === 'HOOK' || l.text === 'OPENING'));
});

test('aligns lyric lines to heard words even with misheard and extra words', () => {
  const { lines } = parseLyrics(LYRICS);
  const words = [];
  let t = 3;
  for (const line of lines) {
    for (const w of tokenize(line.text)) { words.push({ word: w === 'likkle' ? 'little' : w, start: t, end: t + 0.25 }); t += 0.3; }
    words.push({ word: 'yeah', start: t, end: t + 0.2 }); t += 0.9;
  }
  const timed = alignLyrics(lines, words, 30000);
  assert.equal(timed[0].start_ms, 3000);
  for (let i = 1; i < timed.length; i += 1) assert.ok(timed[i].start_ms >= timed[i - 1].end_ms);
  const groove = timed.find((l) => l.text.startsWith('One likkle'));
  assert.ok(groove.confidence > 0.8);
});

test('unheard lines are interpolated, never left without times', () => {
  const lines = [{ text: 'alpha beta' }, { text: 'gamma delta' }, { text: 'epsilon' }];
  const timed = alignLyrics(lines, [{ word: 'alpha', start: 1, end: 1.2 }, { word: 'epsilon', start: 5, end: 5.5 }], 8000);
  assert.ok(timed[1].start_ms >= timed[0].end_ms && timed[1].end_ms <= timed[2].start_ms);
  assert.equal(timed[1].confidence, 0);
});

test('timeline covers the whole song contiguously with scenes the model can make', () => {
  const lines = normalizeTimedLines([
    { text: 'a', vocalist: 'mc', start_ms: 2000, end_ms: 4000 },
    { text: 'b', vocalist: 'mc', start_ms: 4200, end_ms: 6000 },
    { text: 'c', vocalist: 'dj', start_ms: 6100, end_ms: 19000 },
    { text: 'd', vocalist: 'mc', start_ms: 26000, end_ms: 27000 },
  ], 30000);
  const scenes = buildTimeline(lines, 30000);
  assert.equal(scenes[0].start_ms, 0);
  assert.equal(scenes[scenes.length - 1].end_ms, 30000);
  for (let i = 1; i < scenes.length; i += 1) assert.equal(scenes[i].start_ms, scenes[i - 1].end_ms);
  assert.ok(scenes.every((s) => s.end_ms - s.start_ms <= MAX_SCENE_MS && s.end_ms - s.start_ms >= 1000));
  assert.ok(scenes.some((s) => !s.lip_sync)); // instrumental gap 19s-26s
  assert.ok(scenes.filter((s) => s.vocalist === 'dj').length >= 2); // 13s line split
  const rows = timelineToScenes(scenes, { cast: [{ key: 'mc', label: 'MC', description: 'a tall MC in a gold jacket' }] });
  const sung = rows.find((r) => r.lip_sync);
  assert.match(sung.prompt, /tall MC in a gold jacket/);
  assert.match(sung.prompt, /mouth clearly visible/);
  assert.match(sung.prompt, /no shimmering/);
  assert.match(sung.shot_direction, /Eye Level/);
});

test('real song lyrics produce a full-length timeline', () => {
  const raw = `[MC]\n${Array.from({ length: 40 }, (_, i) => `line number ${i} goes here`).join('\n')}`;
  const { lines } = parseLyrics(raw);
  const words = [];
  let t = 1;
  lines.forEach((l) => { tokenize(l.text).forEach((w) => { words.push({ word: w, start: t, end: t + 0.3 }); t += 0.35; }); t += 1.4; });
  const scenes = buildTimeline(alignLyrics(lines, words, 155800), 155800);
  assert.equal(scenes[scenes.length - 1].end_ms, 155800);
  assert.ok(scenes.length <= 80);
});

test('renderer cuts song-timed clips on exact frames with no drift', () => {
  const takes = [
    { start_ms: 0, end_ms: 4633 },
    { start_ms: 4633, end_ms: 9100 },
    { start_ms: 9100, end_ms: 15999 },
  ];
  const timing = planClipTiming(takes, [{ duration: 5 }, { duration: 5 }, { duration: 5 }]);
  const frames = timing.reduce((t, c) => t + c.frames, 0);
  assert.equal(frames, Math.round(15.999 * 30));
  assert.ok(timing[2].padSeconds > 1.8); // 5s clip held to fill a 6.9s scene
  const graph = buildFilterGraph({ clips: timing.map((c) => ({ ...c, hasAudio: false })), size: { width: 1280, height: 720 }, silenceIndexes: { 0: 3, 1: 4, 2: 5 }, watermark: false });
  assert.match(graph, /trim=end_frame=139/);
  assert.match(graph, /tpad=stop_mode=clone/);
  // Untimed takes keep their full length (unchanged behaviour).
  assert.deepEqual(planClipTiming([{ duration: 8 }], [{ duration: 5 }])[0], { duration: 5, frames: null, padSeconds: 0 });
});

test('export prefers the lip-synced take for sung scenes', () => {
  const scenes = [
    { id: 's1', position: 1, title: 'Hook', lip_sync: true, start_ms: 0, end_ms: 4000 },
    { id: 's2', position: 2, title: 'Verse', lip_sync: true, start_ms: 4000, end_ms: 8000 },
  ];
  const versions = [
    { id: 'v1', scene_id: 's1', version: 1, output_url: 'https://a/1.mp4', approved: true, kind: 'video' },
    { id: 'v2', scene_id: 's1', version: 2, output_url: 'https://a/2.mp4', kind: 'lip_sync' },
    { id: 'v3', scene_id: 's2', version: 1, output_url: 'https://a/3.mp4', kind: 'video' },
  ];
  const { takes, unsynced } = chooseTakes(scenes, versions);
  assert.equal(takes[0].version_id, 'v2');
  assert.equal(takes[0].end_ms, 4000);
  assert.deepEqual(unsynced, ['Scene 2 (Verse)']);
});

test('lip sync is priced per second of song audio', () => {
  assert.equal(providerCostCents({ model: 'volcengine-video-to-video-lip-sync', operation: 'lip_sync', durationSeconds: 5, ruleCostCents: 6 }), 30);
  assert.equal(providerCostCents({ model: 'volcengine-video-to-video-lip-sync', operation: 'lip_sync', durationSeconds: 4.2, ruleCostCents: 6 }), 30);
});

test('lip sync generation is server-controlled', () => {
  const route = readFileSync(new URL('../app/api/generate/route.js', import.meta.url), 'utf8');
  assert.match(route, /sliceSongForScene/);
  assert.match(route, /separate_vocal: true/);
  assert.match(route, /song slice longer than priced/);
  const migration = readFileSync(new URL('../supabase/migrations/20261015120000_music_lip_sync.sql', import.meta.url), 'utf8');
  assert.match(migration, /'lip_sync'/);
  assert.match(migration, /volcengine-video-to-video-lip-sync/);
});

test('"Both" alternates the lip-synced singer and backing chants are never lip-synced', () => {
  const { lines, cast } = parseLyrics(`[Afro-Canadian]\nOne two three four\n[Both]\nAct normal now\n[Ladies]\nAct normal now\n[Jamaican]\nFive six seven eight\n[Both]\nAct normal now`);
  const timed = lines.map((l, i) => ({ ...l, start_ms: 1000 + i * 4000, end_ms: 3500 + i * 4000, confidence: 1 }));
  const timeline = buildTimeline(timed, 22000, { cast });
  const scenes = timelineToScenes(timeline, { cast, resolution: '1080p' });
  const sung = scenes.filter((s) => s.lip_sync);
  assert.ok(sung.every((s) => ['afro-canadian', 'jamaican'].includes(s.vocalist)));
  assert.ok(!scenes.some((s) => s.lip_sync && /ladies/i.test(s.title)));
  const both = sung.filter((s) => s.title.startsWith('Both'));
  assert.equal(both.length, 2);
  assert.notEqual(both[0].vocalist, both[1].vocalist);
  assert.ok(scenes.some((s) => !s.lip_sync && s.lyric_text === 'Act normal now' && /chanting/.test(s.prompt)));
  assert.ok(scenes.every((s) => s.shot_direction.includes('1080p') && !s.shot_direction.includes('720p')));
  // Contiguous, whole song.
  assert.equal(scenes[0].start_ms, 0);
  assert.equal(scenes[scenes.length - 1].end_ms, 22000);
  for (let i = 1; i < scenes.length; i += 1) assert.equal(scenes[i].start_ms, scenes[i - 1].end_ms);
});

test('songs are heard in overlapping windows and stitched without duplicate or lost words', async () => {
  const { chunkPlan, stitchWords } = await import('../lib/music/transcribe.js');
  const plan = chunkPlan(155800);
  assert.equal(plan[0].start, 0);
  assert.equal(plan[plan.length - 1].end, 155800);
  for (let i = 1; i < plan.length; i += 1) assert.ok(plan[i].start < plan[i - 1].end); // overlap
  // A word at 27 s appears in both window 0 (27 s) and window 1 (3 s); keep one.
  const words = stitchWords([
    { start: 0, end: 30000, words: [{ word: 'a', start: 10, end: 10.4 }, { word: 'x', start: 27, end: 27.3 }] },
    { start: 24000, end: 54000, words: [{ word: 'x', start: 3, end: 3.3 }, { word: 'b', start: 20, end: 20.5 }] },
  ]);
  assert.deepEqual(words.map((w) => w.word), ['a', 'x', 'b']);
  assert.equal(words[2].start, 44);
});
