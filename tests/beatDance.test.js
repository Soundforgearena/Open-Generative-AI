import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { estimateTempo, TEMPO_SAMPLE_RATE } from '../lib/music/beat.js';
import { beatDanceFor, beatDancePrompt, beatAspect, isDanceScene } from '../lib/music/beat-dance.js';
import { parseShotDirection, serializeShotDirection } from '../lib/studio/studio-model.js';

function clicks(bpm, seconds = 30) {
  const sr = TEMPO_SAMPLE_RATE; const pcm = new Float32Array(sr * seconds);
  const period = (60 / bpm) * sr;
  for (let t = 0; t < pcm.length; t += period) {
    for (let i = 0; i < 400 && t + i < pcm.length; i += 1) pcm[Math.floor(t) + i] = Math.sin(i / 3) * Math.exp(-i / 80);
  }
  return pcm;
}

test('tempo is measured from the audio within 1 BPM', () => {
  for (const bpm of [92, 104, 118, 128]) {
    const r = estimateTempo(clicks(bpm));
    assert.ok(Math.abs(r.bpm - bpm) < 1, `${bpm} -> ${r.bpm}`);
  }
});

test('only non-sung dance scenes of 3-15 s become beat dance shots', () => {
  const base = { lip_sync: false, start_ms: 0, end_ms: 5565, prompt: 'wide shot of the crowd erupting into dance' };
  assert.deepEqual(beatDanceFor(base), { windowMs: 5565, seconds: 6 });
  assert.equal(beatDanceFor({ ...base, end_ms: 3400 }).seconds, 4); // provider minimum
  assert.equal(beatDanceFor({ ...base, end_ms: 1880 }), null); // too short
  assert.equal(beatDanceFor({ ...base, end_ms: 16000 }), null); // over 15 s
  assert.equal(beatDanceFor({ ...base, lip_sync: true }), null); // sung scenes perform instead
  assert.equal(beatDanceFor({ ...base, prompt: 'reaction shots of people laughing' }), null);
  assert.ok(beatDanceFor({ ...base, prompt: 'reaction shots of people laughing' }, 'on'));
  assert.equal(beatDanceFor(base, 'off'), null);
  assert.equal(isDanceScene({ prompt: 'detail shots of feet sliding and hands clapping on the beat' }), true);
});

test('the dance setting round-trips and defaults to auto', () => {
  assert.equal(parseShotDirection('').dance, 'auto');
  assert.equal(parseShotDirection(serializeShotDirection({ dance: 'off' })).dance, 'off');
  assert.equal(parseShotDirection(serializeShotDirection({ dance: 'weird' })).dance, 'auto');
});

test('prompt keeps the still exact, times moves to the audio and fits the limit', () => {
  const p = beatDancePrompt({ scenePrompt: 'crowd dancing', bpm: 104.4 });
  assert.match(p, /@image1 is the exact opening frame/);
  assert.match(p, /dances to @audio1\. The track is about 104 BPM/);
  assert.match(p, /no warped limbs/);
  assert.ok(p.length <= 4000);
  assert.equal(beatAspect('21:9'), '16:9');
  assert.equal(beatAspect('9:16'), '9:16');
});

test('generate sends the still and the song slice, priced as one flat clip', () => {
  const gen = readFileSync(new URL('../app/api/generate/route.js', import.meta.url), 'utf8');
  assert.match(gen, /images_list: \[firstFrame\],\n\s+audio_files: \[beatSlice\.url\]/);
  assert.match(gen, /beat \? 'beat_dance'/);
  const sql = readFileSync(new URL('../supabase/migrations/20261016210000_beat_dance.sql', import.meta.url), 'utf8');
  assert.match(sql, /'seedance-2-omni-reference-no-video-fast', 'video', 75/);
  assert.match(sql, /false, 'Beat-synced dance shot'/);
});

test('crowds, dancers and the backing group are mixed by default', async () => {
  const { scenePrompt, ENSEMBLE, BACKING_WOMEN } = await import('../lib/music/lyrics.js');
  const cast = [{ key: 'ladies', role: 'backing', label: 'Ladies', description: '' }];
  const p = scenePrompt({ lip_sync: false, chant: 'Act normal now', chant_by: 'ladies', section: 'Hook' }, { cast, index: 0 });
  assert.ok(p.includes(ENSEMBLE));
  assert.match(p, /Black, white, South Asian and Latina women chanting "Act normal now"/);
  assert.ok(BACKING_WOMEN.length > 0);
  // A described group keeps the creator's own description.
  const own = scenePrompt({ lip_sync: false, chant: 'hey', chant_by: 'ladies' }, { cast: [{ ...cast[0], description: 'three bridesmaids' }] });
  assert.match(own, /three bridesmaids chanting/);
});

test('the mixed-crowd wording never turns a non-dance scene into a paid dance shot', async () => {
  const { scenePrompt } = await import('../lib/music/lyrics.js');
  const p = scenePrompt({ lip_sync: false, section: 'Hook' }, { index: 4 }); // reaction shots
  assert.equal(isDanceScene({ prompt: p }), false);
  const d = scenePrompt({ lip_sync: false, section: 'Intro' }, { index: 0 }); // crowd dance
  assert.equal(isDanceScene({ prompt: d }), true);
});

test('dance shots follow the visual style (location) sent by the Studio', () => {
  const gen = readFileSync(new URL('../app/api/generate/route.js', import.meta.url), 'utf8');
  assert.match(gen, /scenePrompt: String\(input\.prompt \|\| beat\.scene\.prompt/);
  const p = beatDancePrompt({ scenePrompt: 'crowd dancing, Caribbean street party at night, string lights', bpm: 104 });
  assert.match(p, /Caribbean street party at night/);
});
