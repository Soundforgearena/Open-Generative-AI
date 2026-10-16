import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadRuntimeSafetySignals } from '../lib/billing/runtime-safety-signals.js';
import { evaluateProviderExposure } from '../lib/billing/provider-exposure-guard.js';
import { evaluateReservationRisk } from '../lib/billing/risk-policy.js';
import { buildPreflightReport } from '../lib/billing/generation-preflight.js';
import { AT_COST_POLICY, atCostCredits, isAtCostUser } from '../lib/billing/at-cost.js';
import { providerCostCents } from '../lib/billing/provider-pricing.js';
import { PLAN_PRICING_POLICY, planCredits } from '../lib/billing/plan-pricing.js';

const variable = 'CINEXVIDEO_STARTING_PROVIDER_ALLOWANCE_CENTS';
const source = await readFile(new URL('../app/api/generate/route.js', import.meta.url), 'utf8');

// Execute the real route body with real billing helpers and isolated I/O. No
// server, credentials, database, or provider network calls are used by this test.
function routeHarness({ credits, used = 0, revenue = 0, chargeback = false, superAdmin = false }) {
  const reservations = [];
  const unexpected = () => { throw new Error('Unexpected I/O in isolated route test'); };
  const dependencies = {
    guard: async (_request, options) => {
      assert.deepEqual(options, { blockOnMaintenance: true });
      return { user: { id: 'u' }, superAdmin };
    },
    selectOne: async (table) => {
      if (table === 'model_cost_rules') return {
        provider: 'muapi', provider_cost_cents: credits / 2, max_references: null,
      };
      if (table === 'credit_wallets') return { balance: 10000 };
      if (table === 'generation_requests') return {
        id: 'existing-job', provider_request_id: 'already-submitted', status: 'queued',
      };
      return unexpected();
    },
    selectRows: async (table, filters) => {
      if (table === 'revenue_events') return [{ net_cents: revenue }];
      if (table === 'refund_records') return chargeback ? [{ kind: 'dispute_created' }] : [];
      if (table === 'credit_reservations') {
        return filters.user_id ? [] : [{ max_reservation_credits: used }];
      }
      return unexpected();
    },
    callRpc: async (name, args) => {
      if (name === 'quote_generation') return { ok: true, data: { approved: true, credits } };
      if (name === 'paid_credits_available') return { ok: true, data: 10000 };
      if (name === 'reserve_credits_v2' || name === 'reserve_paid_credits_v1') {
        reservations.push({ name, args });
        // The existing idempotent job path prevents any provider submission.
        return { ok: true, data: { id: 'reservation', generation_job_id: 'existing-job' } };
      }
      return unexpected();
    },
    safeError: (error, status = 400) => Response.json({ error }, { status }),
    rateLimit: () => null,
    insertRows: unexpected, updateRows: unexpected, requireSecret: unexpected,
    fetch: unexpected, normalizeMuapiCost: unexpected,
    AT_COST_POLICY, atCostCredits, isAtCostUser, providerCostCents,
    PLAN_PRICING_POLICY, planCredits, planCodeFor: async () => null, runStillJob: unexpected,
    loadRuntimeSafetySignals, evaluateProviderExposure, evaluateReservationRisk, buildPreflightReport,
  };
  const body = source.replace(/^import\s+[\s\S]*?\s+from\s+['"][^'"]+['"];\n/gm, '')
    .replace('export async function POST', 'async function POST');
  const POST = new Function(...Object.keys(dependencies), `${body}\nreturn POST;`)(...Object.values(dependencies));
  return {
    reservations,
    invoke: (preflight, extra = {}, withKey = true) => POST(new Request('http://localhost/api/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(withKey ? { 'idempotency-key': 'test-idempotency-key' } : {}),
      },
      body: JSON.stringify({
        model: 'isolated-test-model', input: { prompt: 'test' },
        preflight, confirmed_max_credits: credits, ...extra,
      }),
    })),
  };
}

function configure(t, allowance) {
  for (const [key, value] of Object.entries({
    [variable]: allowance, MUAPI_API_KEY: 'not-a-real-key', SUPER_ADMIN_AT_COST: 'true',
  })) {
    const previous = process.env[key];
    t.after(() => {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    });
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

for (const scenario of [
  { name: 'default disabled', allowance: undefined, credits: 1, allowed: false },
  { name: 'explicit disabled', allowance: '0', credits: 1, allowed: false },
  { name: 'exact $5 cap', allowance: '500', credits: 500, allowed: true },
  { name: 'oversized config stays capped', allowance: '5000', credits: 501, allowed: false },
  { name: 'remaining partial allowance', allowance: '500', used: 300, credits: 200, allowed: true },
  { name: 'partial allowance exceeded', allowance: '500', used: 300, credits: 201, allowed: false },
  { name: 'near-limit remains queued', allowance: '500', used: 425, credits: 1, allowed: false },
  { name: 'first real revenue removes allowance', allowance: '500', revenue: 100, credits: 36, allowed: false },
  { name: '35% revenue boundary unchanged', allowance: '500', revenue: 100, credits: 35, allowed: true },
  { name: 'at-cost preflight also shares the guard', allowance: '500', credits: 100, superAdmin: true, allowed: true },
]) {
  test(`preflight and actual generation agree: ${scenario.name}`, async (t) => {
    configure(t, scenario.allowance);
    const route = routeHarness(scenario);
    const maliciousOverrides = {
      startingProviderAllowanceCents: 999999, floorCents: 999999,
      [variable]: '999999', exposure: { startingProviderAllowanceCents: 999999 },
    };
    const preflight = await route.invoke(true, maliciousOverrides);
    assert.equal(preflight.status, 200);
    const report = await preflight.json();
    assert.equal(report.ready, scenario.allowed);
    assert.equal(report.credits_charged, 0);
    assert.doesNotMatch(JSON.stringify(report), /Allowance|floorCents|capCents|CINEXVIDEO_STARTING/);
    assert.equal(route.reservations.length, 0);
    const actual = await route.invoke(false, maliciousOverrides);
    assert.equal(actual.status, scenario.allowed ? 202 : 503);
    assert.equal(route.reservations.length, scenario.allowed ? 1 : 0);
    if (scenario.allowed) {
      assert.equal(route.reservations[0].name, scenario.superAdmin ? 'reserve_paid_credits_v1' : 'reserve_credits_v2');
      assert.equal(route.reservations[0].args.p_idempotency_key, 'test-idempotency-key');
      assert.equal((await actual.json()).job_id, 'existing-job');
    }
  });
}

test('allowance does not bypass risk, price confirmation, or idempotency requirements', async (t) => {
  configure(t, '500');
  const risky = routeHarness({ credits: 100, chargeback: true });
  assert.equal((await risky.invoke(true).then(r => r.json())).ready, false);
  assert.equal((await risky.invoke(false)).status, 403);
  assert.equal(risky.reservations.length, 0);
  const route = routeHarness({ credits: 100 });
  assert.equal((await route.invoke(false, { confirmed_max_credits: 99 })).status, 409);
  assert.equal((await route.invoke(false, {}, false)).status, 400);
  assert.equal(route.reservations.length, 0);
});
