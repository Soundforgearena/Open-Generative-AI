import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { keyframeCents, keyframePrompt, LIKENESS_VIDEO_MODEL, KEYFRAME_MODEL } from '../lib/music/likeness.js';
import { providerCostCents } from '../lib/billing/provider-pricing.js';

test('real-face scenes price the first frame plus image-to-video per second', () => {
  assert.equal(LIKENESS_VIDEO_MODEL, 'pixverse-v6-i2v');
  assert.equal(KEYFRAME_MODEL, 'nano-banana-2-edit');
  assert.equal(keyframeCents('720p'), 6);
  assert.equal(keyframeCents('1080p'), 9);
  assert.equal(keyframeCents('weird'), 9); // unknown resolution never under-charges
  const video = providerCostCents({ model: LIKENESS_VIDEO_MODEL, operation: 'video', durationSeconds: 5, resolution: '1080p', ruleCostCents: 3.3 });
  assert.equal(video, 59.5);
});

test('first-frame prompt keeps identity and adds frontal framing for sung shots', () => {
  const sung = keyframePrompt('neon dancehall at night', { name: 'Jamaican singer', singing: true });
  assert.match(sung, /exact same person/);
  assert.match(sung, /face, identity, bone structure, skin tone/);
  assert.match(sung, /frontal, looking into the lens/);
  assert.match(sung, /neon dancehall at night/);
  const story = keyframePrompt('rainy street', { name: 'Maya' });
  assert.doesNotMatch(story, /mid-lyric/);
});

test('the server, not the browser, decides when a real face is used', () => {
  const route = readFileSync(new URL('../app/api/generate/route.js', import.meta.url), 'utf8');
  assert.match(route, /resolveSceneLikeness\(sceneId\)/);
  assert.match(route, /keyframeCents\(resolution\)/);
  const lib = readFileSync(new URL('../lib/music/likeness.js', import.meta.url), 'utf8');
  assert.match(lib, /likeness_consent !== true\) return null/);
  assert.match(lib, /project_id: `eq.\$\{scene.project_id\}`/); // only this project's photos
  const scenes = readFileSync(new URL('../app/api/scenes/[id]/route.js', import.meta.url), 'utf8');
  assert.match(scenes, /Confirm you have permission to use this face first/);
});
