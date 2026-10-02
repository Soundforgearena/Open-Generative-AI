import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  parseShotDirection, serializeShotDirection, buildProviderPrompt, sceneHealth,
  continuityBetween, resolutionsFor, normalizeTags, timelineOffsets, waveformBars, formatClock,
} from '../lib/studio/studio-model.js';

test('shot controls round-trip and reject unknown values', () => {
  const s = serializeShotDirection({ shot: 'Close-Up', movement: 'Orbit', angle: 'NOT REAL', lens: '85mm (portrait)', tags: ['Epic', 'epic', '<b>x'] });
  const c = parseShotDirection(s);
  assert.equal(c.shot, 'Close-Up'); assert.equal(c.movement, 'Orbit'); assert.equal(c.angle, 'Slight Low Angle');
  assert.deepEqual(c.tags, ['epic', 'bx']);
});
test('legacy plain-text shot direction is preserved as notes', () => {
  assert.equal(parseShotDirection('50mm handheld').notes, '50mm handheld');
});
test('provider prompt carries story, camera language, style and tags', () => {
  const p = buildProviderPrompt({ prompt: 'A dragon over a castle', controls: { shot: 'Wide Shot', movement: 'Slow Push In', angle: 'Low Angle', lens: '35mm (cinematic)', tags: ['8k'] }, style: 'Epic Fantasy' });
  assert.match(p, /A dragon over a castle/); assert.match(p, /Wide Shot, slow push in, low angle, 35mm lens/); assert.match(p, /Epic Fantasy/); assert.match(p, /8k/);
  assert.ok(p.length <= 4800);
});
test('scene health maps to Flight Path colours', () => {
  assert.equal(sceneHealth({ status: 'failed' }), 'issue');
  assert.equal(sceneHealth({ status: 'approved', continuity_locked: true }), 'good');
  assert.equal(sceneHealth({ status: 'needs_review' }), 'warning');
  assert.equal(sceneHealth({ status: 'draft' }), 'pending');
});
test('continuity is good only when both scenes are locked', () => {
  assert.equal(continuityBetween({ continuity_locked: true }, { continuity_locked: true }).state, 'good');
  assert.equal(continuityBetween({ continuity_locked: true }, { continuity_locked: false }).state, 'warning');
  assert.equal(continuityBetween({}, undefined).state, 'none');
});
test('resolutions respect the model cap', () => {
  assert.deepEqual(resolutionsFor('720p').map((r) => r.value), ['720p']);
  assert.deepEqual(resolutionsFor('1080p').map((r) => r.value), ['720p', '1080p']);
});
test('timeline helpers', () => {
  assert.deepEqual(timelineOffsets([{ id: 'a', duration_seconds: 12 }, { id: 'b', duration_seconds: 18 }]).map((o) => o.end), [12, 30]);
  assert.deepEqual(waveformBars('x', 10), waveformBars('x', 10));
  assert.equal(formatClock(102), '01:42');
  assert.equal(normalizeTags(new Array(20).fill(0).map((_, i) => `t${i}`)).length, 12);
});
test('studio generation always quotes and confirms before spending', async () => {
  const src = await readFile(new URL('../components/studio/Studio.js', import.meta.url), 'utf8');
  assert.match(src, /quoteGeneration/);
  assert.match(src, /confirmed_max_credits: dialog\.byScene\[s\.id\]/);
  assert.match(src, /Start paid generation\?/);
  const readiness = src.slice(src.indexOf('async function checkReadiness'), src.indexOf('async function approveTake'));
  assert.match(readiness, /preflightGeneration/); assert.doesNotMatch(readiness, /startGeneration/);
});
test('demo studio data never ships to production', async () => {
  const mode = await readFile(new URL('../lib/demo-mode.js', import.meta.url), 'utf8');
  assert.match(mode, /NODE_ENV !== 'production'/);
});
test('studio route is session-protected', async () => {
  const mw = await readFile(new URL('../middleware.js', import.meta.url), 'utf8');
  assert.match(mw, /startsWith\('\/studio'\)/);
});
