import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decide, decideAll, moderate, blockedMessage, recordModeration, stripLyricQuotes } from '../lib/moderation/moderate.js';
import { handleModeration, quarantineKey } from '../lib/moderation/cases.js';
import { checkTakeOnce } from '../lib/moderation/take-check.js';
import { frameTimes } from '../lib/moderation/frames.js';
import { SAFETY_RULE, stillPrompt, keyframePrompt, likenessMotionPrompt } from '../lib/music/likeness.js';
import { beatDancePrompt } from '../lib/music/beat-dance.js';
import { describeModeration } from '../lib/premieres/content-policy.js';
import { sectionsForRole } from '../lib/admin/sections.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const result = (scores = {}, categories = {}) => ({ category_scores: scores, categories });

test('explicit content is blocked; action and drama are not', () => {
  assert.equal(decide(result({ sexual: 0.31 })).allowed, false);
  assert.equal(decide(result({ sexual: 0.1, violence: 0.7, harassment: 0.6 })).allowed, true, 'action, anger and diss lines are allowed');
  assert.equal(decide(result({ 'violence/graphic': 0.9 })).allowed, false);
  assert.equal(decide(result({ 'violence/graphic': 0.5 })).allowed, true);
  assert.equal(decide(result({ hate: 0.6 })).labels[0], 'hate speech');
});

test('child sexualisation is severe, and suspends only when OpenAI flags it', () => {
  const near = decide(result({ 'sexual/minors': 0.25 }));
  assert.equal(near.allowed, false);
  assert.equal(near.severe, true);
  assert.equal(near.suspend, false);
  const flagged = decide(result({ 'sexual/minors': 0.05 }, { 'sexual/minors': true }));
  assert.equal(flagged.allowed, false);
  assert.equal(flagged.suspend, true);
});

test('any blocked part blocks the whole request', () => {
  const d = decideAll([result({}), result({ sexual: 0.8 })]);
  assert.equal(d.allowed, false);
  assert.deepEqual(d.categories, ['sexual']);
});

test('quoted song lyrics are not text-checked; the pictures still are', () => {
  assert.equal(stripLyricQuotes('Ray performing to camera, singing the words "explicit line here", face visible'), 'Ray performing to camera, singing the lyrics, face visible');
});

test('moderate sends text with the first image and each image separately', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ results: [result({ sexual: calls.length === 2 ? 0.9 : 0 })] }) };
  };
  const d = await moderate({ text: 'a street party', imageUrls: ['https://a/1.jpg', 'https://a/2.jpg'] }, { fetchImpl, apiKey: 'k' });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].model, 'omni-moderation-latest');
  assert.deepEqual(calls[0].input.map((i) => i.type), ['text', 'image_url']);
  assert.deepEqual(calls[1].input.map((i) => i.type), ['image_url']);
  assert.equal(d.allowed, false);
});

test('moderation outages fail open but are marked unchecked', async () => {
  const d = await moderate({ text: 'x' }, { fetchImpl: async () => ({ ok: false, status: 500 }), apiKey: 'k' });
  assert.equal(d.allowed, true);
  assert.equal(d.unchecked, true);
  const e = await moderate({ text: 'x' }, { fetchImpl: async () => { throw new Error('down'); }, apiKey: 'k' });
  assert.equal(e.unchecked, true);
  assert.equal((await moderate({ text: '' }, { apiKey: 'k' })).skipped, true);
});

test('blocked messages say what happened to the credits and never show scores', () => {
  const d = decide(result({ sexual: 0.9 }));
  assert.match(blockedMessage(d), /Nothing was charged/);
  assert.match(blockedMessage(d, { charged: true }), /credits were returned/);
  assert.ok(!/0\.9/.test(blockedMessage(d)));
});

test('blocks are logged, cases opened and media quarantined; flagged child-safety suspends', async () => {
  const rows = [];
  const updates = [];
  const deps = {
    insertRows: async (table, row) => { rows.push([table, row]); return { ok: true, data: [{ id: 'case-1' }] }; },
    updateRows: async (table, f, patch) => { updates.push([table, patch]); return { ok: true }; },
    env: {},
    awaitMedia: true,
  };
  const d = decide(result({ 'sexual/minors': 0.9 }, { 'sexual/minors': true }));
  const id = await handleModeration(d, { userId: 'u1', kind: 'take', where: 'take_video', mediaUrl: 'https://provider/x.mp4' }, deps);
  assert.equal(id, 'case-1');
  const tables = rows.map((r) => r[0]);
  assert.deepEqual(tables, ['admin_metric_events', 'user_account_status', 'moderation_cases']);
  assert.equal(rows[0][1].event_type, 'moderation_blocked_severe');
  assert.equal(rows[1][1].active, false);
  assert.equal(rows[2][1].severe, true);
  assert.equal(rows[2][1].account_suspended, true);
  assert.match(updates[0][1].notes, /storage_off/, 'quarantine copy attempted');
  assert.equal(quarantineKey('u1', 'case-1'), 'quarantine/u1/case-1');
  const none = [];
  await recordModeration(decide(result({})), { userId: 'u', where: 'w', insertRows: async (...a) => none.push(a) });
  assert.equal(none.length, 0, 'allowed requests are not logged');
});

test('a take is checked once, concurrent polls wait', async () => {
  let n = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  const frames = async () => { n += 1; await gate; return ['data:image/jpeg;base64,AAAA']; };
  const check = async () => ({ allowed: false, categories: ['sexual'], labels: ['sexual or nude content'], top: {} });
  const first = checkTakeOnce('job-x', 'https://v', { frames, check });
  assert.deepEqual(await checkTakeOnce('job-x', 'https://v', { frames, check }), { pending: true });
  release();
  assert.equal((await first).allowed, false);
  assert.equal((await checkTakeOnce('job-x', 'https://v', { frames, check })).allowed, false);
  assert.equal(n, 1);
  const broken = await checkTakeOnce('job-y', 'https://v', { frames: async () => { throw new Error('ffmpeg'); }, check });
  assert.equal(broken.unchecked, true);
  assert.deepEqual(frameTimes(10), [0.8, 5, 9.2]);
});

test('every visual prompt says everyone is fully clothed', () => {
  assert.match(SAFETY_RULE, /fully clothed/);
  for (const p of [stillPrompt('a party'), keyframePrompt('a party'), likenessMotionPrompt('a party'), beatDancePrompt({ scenePrompt: 'a party' })]) {
    assert.ok(p.includes(SAFETY_RULE));
  }
  assert.match(read('app/api/generate/route.js'), /\$\{SAFETY_RULE\}/);
});

test('moderation runs before credits are reserved and before results are shown', () => {
  const still = read('lib/generation/still-job.js');
  assert.ok(still.indexOf('const pre = await moderate(') < still.indexOf("callRpc(atCost ? 'reserve_paid_credits_v1'"));
  assert.ok(still.indexOf('const post = await moderate(') < still.indexOf("updateRows('scenes'"));
  assert.match(still, /release\('moderation_blocked'\)/);
  const gen = read('app/api/generate/route.js');
  assert.ok(gen.indexOf('await moderate({ text: promptText })') < gen.indexOf("callRpc(atCost ? 'reserve_paid_credits_v1'"));
  const jobs = read('app/api/jobs/[requestId]/route.js');
  assert.ok(jobs.indexOf('checkTakeOnce(job.id, outputUrl)') < jobs.indexOf("callRpc('settle_reservation_v2'"));
  assert.match(jobs, /status === 'completed' && outputUrl && !blockedTake/);
  assert.match(jobs, /blockedTake \? 'moderation_blocked' : 'provider_failed'/);
  const dir = read('app/api/director/route.js');
  assert.ok(dir.indexOf('await moderate({ text })') < dir.indexOf("charge('assist'"));
});

test('the review queue is super admin only', () => {
  const api = read('app/api/admin/moderation/route.js');
  assert.match(api, /if \(!superAdmin\) return safeError\('Only the super admin can open the review queue\.', 403\)/);
  assert.match(api, /if \(!superAdmin\) return safeError\('Only the super admin can review cases\.', 403\)/);
  assert.match(read('app/admin/moderation/page.js'), /requireSuperAdmin\('\/admin\/moderation'\)/);
  assert.ok(!sectionsForRole('admin').some((s) => s.href === '/admin/moderation'));
  assert.ok(sectionsForRole('super_admin').some((s) => s.href === '/admin/moderation'));
  assert.match(read('app/globals.css'), /filter: blur\(28px\) grayscale\(1\)/);
  const sql = read('supabase/migrations/20261019200000_moderation_cases.sql');
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on public\.moderation_cases from anon, authenticated/);
});

test('moderation shows as connected when the OpenAI key is set', () => {
  assert.equal(describeModeration({ OPENAI_API_KEY: 'k' }).configured, true);
  assert.equal(describeModeration({}).configured, false);
});

test('terms cover age, AI labelling, credits, consent, moderation, reporting and law', () => {
  const t = read('app/terms/page.js');
  for (const phrase of ['at least {LEGAL.minimumAge}', 'AI-generated', 'US$0.01', 'Refund and Credit Policy', 'clear permission', 'Content Policy', 'Cybertip.ca', 'NCMEC', 'Copyright complaints', 'Governing law', 'Consumer Protection Act, 2002']) {
    assert.ok(t.includes(phrase), phrase);
  }
  assert.ok(!t.includes('September 3, 2026'));
  const p = read('app/privacy/page.js');
  for (const phrase of ['PIPEDA', 'GDPR', 'CCPA', 'OpenAI', 'Cloudflare', 'Stripe', 'quarantine', 'six years']) assert.ok(p.includes(phrase), phrase);
  assert.match(read('app/content-policy/page.js'), /Making videos in the Studio/);
  assert.match(read('app/auth/page.js'), /18 or older/);
});
