import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { keyframeCents, keyframePrompt, LIKENESS_VIDEO_MODEL, KEYFRAME_MODEL } from '../lib/music/likeness.js';
import { providerCostCents } from '../lib/billing/provider-pricing.js';

test('real-face scenes price the first frame plus image-to-video per second', () => {
  assert.equal(LIKENESS_VIDEO_MODEL, 'seedance-v1.5-pro-i2v-fast');
  assert.equal(KEYFRAME_MODEL, 'nano-banana-2-edit');
  assert.equal(keyframeCents('720p'), 7);
  assert.equal(keyframeCents('1080p'), 10);
  assert.equal(keyframeCents('weird'), 10); // unknown resolution never under-charges
  const video = providerCostCents({ model: LIKENESS_VIDEO_MODEL, operation: 'video', durationSeconds: 5, resolution: '1080p', ruleCostCents: 13 });
  assert.equal(video, 19.5);
  assert.equal(providerCostCents({ model: LIKENESS_VIDEO_MODEL, operation: 'video', durationSeconds: 7, resolution: '720p', ruleCostCents: 13 }), 18.2);
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

test('a drifted face is retried once, then refused so nothing is animated', async () => {
  process.env.MUAPI_POLL_MS = '1';
  const { makeKeyframe, FaceMismatchError } = await import('../lib/music/likeness.js');
  const prompts = [];
  const realFetch = globalThis.fetch;
  let n = 0;
  globalThis.fetch = async (url, opts) => {
    if (opts?.method === 'POST') { prompts.push(JSON.parse(opts.body).prompt); return new Response(JSON.stringify({ request_id: `r${++n}` })); }
    return new Response(JSON.stringify({ status: 'completed', outputs: [`https://cdn.example/frame${n}.jpg`] }));
  };
  try {
    const args = { base: 'https://x', apiKey: 'k', asset: { id: 'a', name: 'Jamaican' }, scenePrompt: 'stage', resolution: '1080p', signedPhotoUrl: 'https://photo' };
    // Second attempt passes.
    let calls = 0;
    const url = await makeKeyframe({ ...args, check: async () => ({ ok: ++calls > 1, reason: 'nose too narrow' }) });
    assert.equal(url, 'https://cdn.example/frame2.jpg');
    assert.match(prompts[1], /exact match of the reference photo/);
    assert.match(prompts[1], /nose too narrow/);
    // Never passes: refused after two tries.
    await assert.rejects(makeKeyframe({ ...args, check: async () => ({ ok: false, reason: 'different person' }) }), FaceMismatchError);
    assert.equal(prompts.length, 4);
  } finally { globalThis.fetch = realFetch; }
});
