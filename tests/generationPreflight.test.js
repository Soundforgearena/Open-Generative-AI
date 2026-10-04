import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildPreflightReport } from '../lib/billing/generation-preflight.js';
const ok = { credits: 8, balance: 250, risk: { decision: 'allowed' }, exposure: { decision: 'allowed' }, providerKeyPresent: true };
test('preflight is ready when every gate passes and charges nothing', () => {
  const r = buildPreflightReport(ok);
  assert.equal(r.ready, true); assert.equal(r.credits_charged, 0); assert.equal(r.credits_required, 8);
});
test('preflight flags insufficient balance', () => {
  const r = buildPreflightReport({ ...ok, balance: 4 });
  assert.equal(r.ready, false); assert.equal(r.checks.find((c) => c.id === 'balance').ok, false);
});
test('preflight flags a missing provider key without leaking values', () => {
  const r = buildPreflightReport({ ...ok, providerKeyPresent: false });
  assert.equal(r.ready, false); assert.match(JSON.stringify(r), /MUAPI_API_KEY is not set/);
});
test('preflight returns before reserving credits or calling the provider', async () => {
  const src = await readFile(new URL('../app/api/generate/route.js', import.meta.url), 'utf8');
  const pf = src.indexOf('if (preflight === true)');
  assert.ok(pf > 0);
  assert.ok(pf < src.indexOf("callRpc(atCost ? 'reserve_paid_credits_v1' : 'reserve_credits_v2'"));
});
import { summarizeProjectReadiness } from '../lib/billing/generation-preflight.js';
test('project readiness compares the total of all scenes against the balance', () => {
  const s = summarizeProjectReadiness([0,1,2].map(() => buildPreflightReport({ ...ok, balance: 20 })));
  assert.equal(s.totalCredits, 24); assert.equal(s.ready, false); assert.match(s.problems[0], /20 available, 24 needed/);
});
test('project readiness is ready when balance covers every scene', () => {
  const s = summarizeProjectReadiness([0,1,2].map(() => buildPreflightReport(ok)));
  assert.equal(s.ready, true); assert.equal(s.totalCredits, 24);
});
test('review page offers a free readiness check that uses preflight, not reservation', async () => {
  const page = await readFile(new URL('../app/create/review/page.js', import.meta.url), 'utf8');
  assert.match(page, /Check readiness \(free\)/);
  const fn = page.slice(page.indexOf('async function checkReadiness'), page.indexOf('async function saveChanges'));
  assert.match(fn, /preflightGeneration/); assert.doesNotMatch(fn, /confirmed_max_credits|startGeneration|idempotency/);
});
