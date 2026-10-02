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
  assert.ok(pf < src.indexOf("callRpc('reserve_credits_v2'"));
});
