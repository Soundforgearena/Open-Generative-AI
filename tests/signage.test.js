import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSignText, signWords, textRule, TEXT_MOTION_RULE } from '../lib/director/signage.js';
import { buildProviderPrompt } from '../lib/studio/studio-model.js';
import { keyframePrompt, likenessMotionPrompt, makeKeyframe, makeStill, stillPrompt, FaceMismatchError, StillQualityError } from '../lib/music/likeness.js';
import { beatDancePrompt } from '../lib/music/beat-dance.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('signs get real words that fit the place, or the creator\'s own', () => {
  assert.deepEqual(signWords('Caribbean street party at night'), ['RUM BAR', 'OPEN', 'JERK CHICKEN']);
  assert.deepEqual(signWords('a hospital corridor'), ['EMERGENCY', 'EXIT']);
  assert.deepEqual(signWords('an empty field'), ['OPEN']);
  assert.deepEqual(signWords('club', 'Act Normal Now, Rum Bar'), ['Act Normal Now', 'Rum Bar']);
  assert.deepEqual(parseSignText('a,b,c,d'), ['a', 'b', 'c']);
  assert.equal(parseSignText('<script>x').includes('<'), false);
  // The server reuses the words the Studio already wrote into the prompt.
  assert.deepEqual(signWords(`scene. ${textRule(['Act Normal Now'])}`), ['Act Normal Now']);
});

test('every prompt path carries the real-writing rule (music videos and episodes)', () => {
  const p = buildProviderPrompt({ prompt: 'A rainy police precinct', controls: {}, style: 'noir' });
  assert.match(p, /Writing in frame:.*"POLICE"/);
  assert.match(p, /Never invented letters, gibberish/);
  assert.ok(p.includes(TEXT_MOTION_RULE));
  assert.match(buildProviderPrompt({ prompt: 'x', controls: {}, signText: 'Act Normal Now' }), /"Act Normal Now"/);
  for (const s of [stillPrompt('street party'), keyframePrompt('street party', { singing: true })]) {
    assert.match(s, /Writing in frame:/);
    assert.doesNotMatch(s, /No text,/);
  }
  assert.ok(likenessMotionPrompt('x').includes(TEXT_MOTION_RULE));
  assert.match(beatDancePrompt({ scenePrompt: 'x'.repeat(5000) }), /writing stay exactly as in the first frame/);
});

function fakeMuapi() {
  let n = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/predictions/')) return new Response(JSON.stringify({ status: 'completed', outputs: [`https://cdn/x${n}.jpg`] }));
    n += 1;
    return new Response(JSON.stringify({ request_id: `r${n}` }));
  };
}

test('gibberish writing is retried once, then refunded', async () => {
  const realFetch = globalThis.fetch;
  process.env.MUAPI_POLL_MS = '1';
  try {
    fakeMuapi();
    let calls = 0;
    const url = await makeStill({ base: 'https://m', apiKey: 'k', scenePrompt: 'street party', aspectRatio: '16:9', check: async () => (++calls > 1 ? { ok: true } : { ok: false, textOk: false, textIssue: 'TEMIS' }) });
    assert.ok(url);
    assert.equal(calls, 2);
    fakeMuapi();
    await assert.rejects(makeStill({ base: 'https://m', apiKey: 'k', scenePrompt: 'x', aspectRatio: '16:9', check: async () => ({ ok: false, textOk: false, textIssue: 'TEMIS' }) }), StillQualityError);
    fakeMuapi();
    const args = { base: 'https://m', apiKey: 'k', asset: { id: 'a', name: 'A' }, scenePrompt: 'x', aspectRatio: '16:9', resolution: '720p', signedPhotoUrl: 'https://p' };
    await assert.rejects(makeKeyframe({ ...args, check: async () => ({ ok: false, faceOk: true, textOk: false, textIssue: 'TEMIS' }) }), StillQualityError);
    fakeMuapi();
    await assert.rejects(makeKeyframe({ ...args, check: async () => ({ ok: false, faceOk: false, textOk: true, reason: 'different person' }) }), FaceMismatchError);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('checks, refunds and the Director all enforce real writing', () => {
  const lk = read('lib/music/likeness.js');
  assert.match(lk, /text_ok: \{ type: 'boolean' \}/);
  assert.match(lk, /export async function checkStill/);
  assert.match(read('lib/generation/still-job.js'), /StillQualityError \? 'text_quality'/);
  assert.match(read('app/api/generate/route.js'), /providerError instanceof StillQualityError/);
  assert.match(read('app/api/director/route.js'), /exact, real, correctly spelled words/);
  assert.match(read('lib/director-actions.js'), /correctly spelled and makes sense/);
  assert.match(read('app/api/projects/[id]/route.js'), /next\.sign_text/);
  assert.match(read('components/studio/Studio.js'), /Words on signs/);
});
