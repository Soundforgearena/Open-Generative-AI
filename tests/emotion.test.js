import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EMOTIONS, EMOTION_KEYS, cameraFor, emotionCues, emotionNote, inferEmotion, performWords, shapeArc } from '../lib/director/emotion.js';
import { buildProviderPrompt, parseShotDirection, sanitizeControls, SHOT_TYPES, MOVEMENTS, ANGLES, LENSES } from '../lib/studio/studio-model.js';
import { performPrompt } from '../lib/music/likeness.js';
import { feelTimeline, timelineToScenes } from '../lib/music/lyrics.js';
import { loudnessCurve, windowEnergies } from '../lib/music/energy.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('every emotion has full human direction and valid cameras', () => {
  assert.equal(EMOTION_KEYS.length, 11);
  for (const k of EMOTION_KEYS) {
    const e = EMOTIONS[k];
    for (const field of ['label', 'viewer', 'performance', 'crowd', 'light', 'grade', 'pace', 'perform']) assert.ok(e[field], `${k}.${field}`);
    for (const cam of [e.sung, e.broll]) {
      assert.ok(SHOT_TYPES.includes(cam.shot), `${k} shot ${cam.shot}`);
      assert.ok(MOVEMENTS.includes(cam.movement), `${k} movement ${cam.movement}`);
      assert.ok(ANGLES.includes(cam.angle), `${k} angle ${cam.angle}`);
      assert.ok(LENSES.includes(cam.lens), `${k} lens ${cam.lens}`);
    }
    // Singers stay face-on for lip sync: no tilted or overhead framing.
    assert.ok(['Eye Level', 'Slight Low Angle'].includes(e.sung.angle), `${k} sung angle`);
    assert.ok(['Close-Up', 'Medium Close-Up', 'Medium Shot'].includes(e.sung.shot), `${k} sung shot`);
  }
});

test('the Director reads feeling from words, section and loudness', () => {
  assert.equal(inferEmotion({ lyric: 'I miss you, all these tears', energy: 0.2 }).emotion, 'sadness');
  assert.equal(inferEmotion({ lyric: 'we run this city, can\'t stop', energy: 0.8 }).emotion, 'power');
  assert.equal(inferEmotion({ lyric: 'I hate the lies', energy: 0.9 }).emotion, 'anger');
  assert.equal(inferEmotion({ lyric: 'act normal now', energy: 0.5 }).emotion, 'playful');
  assert.equal(inferEmotion({ section: 'Hook', lyric: 'oh oh', energy: 0.9 }).emotion, 'euphoria');
  assert.equal(inferEmotion({ section: 'Final Hook', lyric: 'oh oh', energy: 0.9 }).emotion, 'release');
  assert.equal(inferEmotion({ section: 'Intro', energy: 0.1 }).emotion, 'tension');
  const quiet = inferEmotion({ section: 'Verse', energy: 0.1 });
  const loud = inferEmotion({ section: 'Verse', energy: 1 });
  assert.ok(loud.intensity > quiet.intensity);
  for (const r of [quiet, loud]) { assert.ok(r.intensity >= 1 && r.intensity <= 10); assert.ok(r.why); }
});

test('the arc never sits flat and the final release is the peak', () => {
  const flat = shapeArc(Array.from({ length: 6 }, () => ({ emotion: 'playful', intensity: 5, why: '' })));
  assert.ok(new Set(flat.map((x) => x.intensity)).size > 1);
  const arc = shapeArc([{ emotion: 'euphoria', intensity: 9 }, { emotion: 'release', intensity: 8 }]);
  assert.ok(arc[1].intensity >= arc[0].intensity);
});

test('feeling comes first in every generation prompt', () => {
  const p = buildProviderPrompt({ prompt: 'A street party', controls: { emotion: 'euphoria', intensity: 9 }, style: 'night', sung: false });
  assert.match(p, /audience should feel pure, rising joy/);
  assert.match(p, /at full intensity/);
  assert.match(p, /whole crowd erupts/);
  assert.ok(p.indexOf('audience should feel') < p.indexOf(' lens'));
  const sung = buildProviderPrompt({ prompt: 'x', controls: { emotion: 'euphoria', intensity: 3 }, sung: true });
  assert.doesNotMatch(sung, /crowd erupts/);
  assert.match(sung, /subtly/);
  assert.doesNotMatch(buildProviderPrompt({ prompt: 'x', controls: {} }), /audience should feel/);
  assert.equal(emotionCues('nope'), '');
});

test('controls keep only real feelings and clamp intensity', () => {
  assert.equal(sanitizeControls({ emotion: 'bogus' }).emotion, '');
  assert.equal(sanitizeControls({ emotion: 'power', intensity: 99 }).intensity, 10);
  assert.equal(sanitizeControls({ intensity: -3 }).intensity, 1);
  assert.equal(sanitizeControls({}).intensity, 6);
});

test('singing prompt stays under the model limit for every feeling', () => {
  for (const k of EMOTION_KEYS) {
    const p = performPrompt(performWords(k));
    assert.ok(p.length <= 130, `${k}: ${p.length}`);
    assert.match(p, /Face stays exactly the same/);
    assert.ok(p.includes(EMOTIONS[k].perform), `${k} keeps its feeling`);
  }
  assert.match(performPrompt(), /Sings with emotion/);
  assert.match(performPrompt('x'.repeat(200)), /Sings with emotion/);
});

test('song scenes carry their feeling into camera, controls and purpose', () => {
  const timeline = [
    { section: 'Intro', start_ms: 0, end_ms: 4000, lip_sync: false, chant: '' },
    { section: 'Hook', start_ms: 4000, end_ms: 8000, lip_sync: true, vocalist: 'mc', lyric_text: 'party tonight, hands up' },
    { section: 'Bridge', start_ms: 8000, end_ms: 12000, lip_sync: true, vocalist: 'mc', lyric_text: 'I miss you, all alone' },
  ];
  const feelings = feelTimeline(timeline, [0.1, 0.95, 0.2]);
  assert.deepEqual(feelings.map((f) => f.emotion), ['tension', 'euphoria', 'sadness']);
  const rows = timelineToScenes(timeline, { cast: [{ key: 'mc', label: 'MC', description: 'an MC' }], energies: [0.1, 0.95, 0.2] });
  rows.forEach((r, i) => {
    const c = parseShotDirection(r.shot_direction);
    assert.equal(c.emotion, feelings[i].emotion);
    assert.equal(c.shot, cameraFor(c.emotion, { sung: Boolean(timeline[i].lip_sync) }).shot);
    assert.match(r.purpose, /^Feeling: /);
  });
  assert.ok(feelings[1].intensity > feelings[0].intensity);
});

test('loudness energy ranks quiet and loud parts of a song', () => {
  const sr = 1000;
  const pcm = new Float32Array(sr * 4);
  for (let i = 0; i < pcm.length; i += 1) pcm[i] = (i < sr * 2 ? 0.05 : 0.8) * Math.sin(i / 3);
  const curve = loudnessCurve(pcm, sr);
  assert.equal(curve.length, 40);
  const [quiet, loud] = windowEnergies(curve, [{ start_ms: 0, end_ms: 2000 }, { start_ms: 2000, end_ms: 4000 }]);
  assert.ok(loud > quiet);
  assert.deepEqual(windowEnergies(new Float32Array(0), [{ start_ms: 0, end_ms: 1 }]), [0.5]);
  assert.ok(emotionNote({ emotion: 'power', intensity: 7, why: 'x' }).startsWith('Feeling: Power 7/10.'));
});

test('the paid AI Director thinks emotion-first', () => {
  const actions = read('lib/director-actions.js');
  assert.match(actions, /decide how the ' \+\s*'audience should feel/);
  assert.match(actions, /emotionalPass/);
  assert.match(actions, /mapEmotionalArc/);
  const route = read('app/api/director/route.js');
  assert.match(route, /emotion: \{ type: 'string', enum: EMOTION_KEYS \}/);
  assert.match(route, /emotional_arc/);
  assert.match(route, /EMOTION_BRIEF/);
  assert.match(route, /Target feeling for the audience/);
  const projects = read('app/api/projects/route.js');
  assert.match(projects, /cameraFor\(scene\.emotion/);
  const music = read('app/api/projects/[id]/music/route.js');
  assert.match(music, /action === 'feel'/);
  assert.match(music, /if \(c\.emotion && !overwrite\) continue/);
  const gen = read('app/api/generate/route.js');
  assert.match(gen, /performPrompt\(performWords\(parseShotDirection\(perform\.scene\.shot_direction\)\.emotion\)\)/);
});
