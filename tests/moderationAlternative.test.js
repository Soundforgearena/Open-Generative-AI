import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { blockedPayload, rewriteBrief, suggestSafeAlternative } from '../lib/moderation/alternative.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const decision = { allowed: false, severe: false, labels: ['sexual or nude content'], categories: ['sexual'] };
const ok = async () => ({ allowed: true });
const reply = (text) => async (url, init) => ({ ok: true, json: async () => ({ output_text: text, _sent: JSON.parse(init.body) }) });

test('the rewrite keeps the scene and states the rules', () => {
  const b = rewriteBrief({ text: 'A singer on a rooftop at sunset', labels: ['sexual or nude content'] });
  assert.match(b, /blocked for sexual or nude content/);
  assert.match(b, /fully clothed/);
  assert.match(b, /Keep everything else: the people, place, story, mood, emotion/);
  assert.match(b, /A singer on a rooftop at sunset$/);
  assert.match(rewriteBrief({ text: 'x', stage: 'result' }), /picture it produced was flagged/);
});

test('a safe alternative is offered only after it passes moderation itself', async () => {
  let sent;
  const fetchImpl = async (url, init) => { sent = JSON.parse(init.body); return { ok: true, json: async () => ({ output_text: 'A singer in a red jacket on a rooftop at sunset, confident and proud' }) }; };
  const alt = await suggestSafeAlternative({ text: 'A singer undressing on a rooftop', decision, userId: 'u-a' }, { fetchImpl, apiKey: 'k', check: ok });
  assert.equal(alt.text, 'A singer in a red jacket on a rooftop at sunset, confident and proud');
  assert.match(alt.note, /reworded/);
  assert.equal(sent.model, 'gpt-5-mini');
  const unsafe = await suggestSafeAlternative({ text: 'x y z', decision, userId: 'u-b' }, { fetchImpl: reply('still bad stuff here'), apiKey: 'k', check: async () => ({ allowed: false }) });
  assert.equal(unsafe, null);
});

test('no alternative for child-safety blocks, outages or empty text', async () => {
  assert.equal(await suggestSafeAlternative({ text: 'x', decision: { ...decision, severe: true }, userId: 'u' }, { fetchImpl: reply('safe text here'), apiKey: 'k', check: ok }), null);
  assert.equal(await suggestSafeAlternative({ text: 'x', decision, userId: 'u' }, { fetchImpl: async () => ({ ok: false }), apiKey: 'k', check: ok }), null);
  assert.equal(await suggestSafeAlternative({ text: 'x', decision, userId: 'u' }, { fetchImpl: async () => { throw new Error('down'); }, apiKey: 'k', check: ok }), null);
  assert.equal(await suggestSafeAlternative({ text: '  ', decision, userId: 'u' }, { apiKey: 'k' }), null);
  assert.equal(await suggestSafeAlternative({ text: 'x', decision, userId: 'u' }, { apiKey: '' }), null);
});

test('alternatives are rate limited per user', async () => {
  const opts = { fetchImpl: reply('A calm and safe scene description'), apiKey: 'k', check: ok };
  let got = 0;
  for (let i = 0; i < 25; i += 1) if (await suggestSafeAlternative({ text: 'x', decision, userId: 'rate-user' }, opts)) got += 1;
  assert.equal(got, 20);
});

test('blocked responses say what, where and offer the alternative', () => {
  const p = blockedPayload({ message: 'm', decision, alternative: { text: 't', note: 'n' }, stage: 'result', sceneId: 's1' });
  assert.deepEqual(p.block, { stage: 'result', target: 'prompt', reasons: ['sexual or nude content'], severe: false, scene_id: 's1', field: null, alternative: { text: 't', note: 'n' } });
  assert.equal(p.blocked, true);
  assert.equal(p.error, 'm');
});

test('every block point returns an alternative', () => {
  const still = read('lib/generation/still-job.js');
  assert.match(still, /photoOnly/);
  assert.match(still, /Choose a different photo of them/);
  assert.equal((still.match(/suggestSafeAlternative\(/g) || []).length, 2);
  assert.match(read('app/api/generate/route.js'), /suggestSafeAlternative\(\{ text: stored\?\.prompt \|\| promptText/);
  assert.match(read('app/api/jobs/[requestId]/route.js'), /blockedTakePayload\(job, user, blockedTake\)/);
  assert.match(read('app/api/director/route.js'), /body\.fields/);
});

test('the Studio shows why, offers the alternative, and continues to the price check after acceptance', () => {
  const s = read('components/studio/Studio.js');
  assert.match(s, /Content check/);
  assert.match(s, /Use this and continue/);
  assert.match(s, /patchScene\(b\.sceneId, \{ prompt: text\.slice\(0, 5000\) \}\)/);
  assert.match(s, /setContinueScene\(null\);\n      openGenerate\(\);/);
  assert.match(s, /if \(error\.data\?\.blocked\) \{ addBlock\(s, error\.data\); continue; \}/);
  assert.match(s, /if \(result\.blocked\) addBlock\(s, result\)/);
  const d = read('components/DemoProjectBuilder.js');
  assert.match(d, /setValues\(\(current\) => \(\{ \.\.\.current, \[blocked\.field\]: blockedDraft\.trim\(\) \}\)\);\n\s+setBlocked\(null\);\n\s+setConfirmPlan\(true\);/);
  assert.match(read('components/studio/StudioDirector.js'), /Content check · suggested instead/);
  assert.match(read('components/AiDirectorAssistant.js'), /Here is a safe version you can use instead/);
});

test('refusals, 4xx models and flagged rewrites are handled; the reason is logged', async () => {
  const reasons = [];
  const refused = await suggestSafeAlternative({ text: 'x', decision, userId: 'r1' }, { fetchImpl: reply("I can't help with that request."), apiKey: 'k', check: ok, onResult: (r) => reasons.push(r) });
  assert.equal(refused, null);
  assert.equal(reasons.pop(), 'refused+refused');
  const models = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body); models.push(body.model);
    if (body.model === 'gpt-5-mini') return { ok: false, status: 400 };
    return { ok: true, json: async () => ({ output: [{ type: 'reasoning', summary: [] }, { type: 'message', content: [{ type: 'output_text', text: 'A dancer in a denim jacket under neon signs' }] }] }) };
  };
  const alt = await suggestSafeAlternative({ text: 'x', decision, userId: 'r2' }, { fetchImpl, apiKey: 'k', check: ok, onResult: (r) => reasons.push(r) });
  assert.equal(alt.text, 'A dancer in a denim jacket under neon signs');
  assert.deepEqual(models, ['gpt-5-mini', 'gpt-5']);
  assert.equal(reasons.pop(), 'ok');
  let n = 0;
  const second = await suggestSafeAlternative({ text: 'x', decision, userId: 'r3' }, { fetchImpl: reply('A singer on a rooftop at golden hour'), apiKey: 'k', check: async () => ({ allowed: (n += 1) > 1 }), onResult: (r) => reasons.push(r) });
  assert.ok(second);
  assert.equal(reasons.pop(), 'ok_after_still_blocked');
  const logged = [];
  await suggestSafeAlternative({ text: 'x', decision, userId: 'r4' }, { fetchImpl: reply('A calm safe description here'), apiKey: 'k', check: ok, insertRows: async (t, row) => logged.push([t, row]) });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(logged[0][0], 'admin_metric_events');
  assert.equal(logged[0][1].event_type, 'moderation_alternative');
  assert.equal(logged[0][1].status, 'ok');
});
