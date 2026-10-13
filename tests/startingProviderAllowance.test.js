import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateProviderExposure,
  normalizeStartingProviderAllowanceCents,
} from '../lib/billing/provider-exposure-guard.js';
import { loadRuntimeSafetySignals } from '../lib/billing/runtime-safety-signals.js';

const variable = 'CINEXVIDEO_STARTING_PROVIDER_ALLOWANCE_CENTS';
function setAllowance(t, value) {
  const previous = process.env[variable];
  t.after(() => {
    if (previous === undefined) delete process.env[variable];
    else process.env[variable] = previous;
  });
  if (value === undefined) delete process.env[variable];
  else process.env[variable] = value;
}

const evaluate = (overrides = {}) => evaluateProviderExposure({
  trailingRevenueCents: 0,
  outstandingReservedCreditsUsdCents: 0,
  requestedCents: 1,
  ...overrides,
});

test('starting allowance is disabled by default and by explicit zero', () => {
  for (const startingProviderAllowanceCents of [undefined, 0, '0']) {
    const result = evaluate({ startingProviderAllowanceCents });
    assert.equal(result.capacity.capCents, 0);
    assert.equal(result.decision, 'blocked');
  }
});

test('only non-negative safe integer cents are accepted; valid values clamp at $5', () => {
  for (const value of [
    undefined, null, '', ' ', ' 500 ', '-1', '+500', '5.0', '500.1', '5e2',
    '0x1f4', '500usd', 'NaN', 'Infinity', true, false, {}, { cents: 500 }, [500],
    -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '9007199254740992',
  ]) {
    assert.equal(normalizeStartingProviderAllowanceCents(value), 0, String(value));
  }
  for (const [value, expected] of [
    [0, 0], ['0', 0], ['001', 1], [250, 250], ['500', 500],
    ['501', 500], [5000, 500], [Number.MAX_SAFE_INTEGER, 500],
  ]) {
    assert.equal(normalizeStartingProviderAllowanceCents(value), expected);
    assert.equal(evaluate({ startingProviderAllowanceCents: value }).capacity.capCents, expected);
  }
});

test('zero revenue permits exactly $5 total, never a request above the cap', () => {
  const result = evaluate({ startingProviderAllowanceCents: 500, requestedCents: 500 });
  assert.equal(result.decision, 'allowed');
  assert.equal(result.capacity.capCents, 500);
  for (const startingProviderAllowanceCents of [500, 5000]) {
    const blocked = evaluate({ startingProviderAllowanceCents, requestedCents: 501 });
    assert.equal(blocked.decision, 'blocked');
    assert.equal(blocked.reason, 'PROVIDER_EXPOSURE_LIMIT');
  }
});

test('partial reservations reduce shared remaining allowance, not a per-request $5 grant', () => {
  const base = { startingProviderAllowanceCents: 500, outstandingReservedCreditsUsdCents: 300 };
  const allowed = evaluate({ ...base, requestedCents: 200 });
  assert.equal(allowed.capacity.remainingCents, 200);
  assert.equal(allowed.decision, 'allowed');
  assert.equal(evaluate({ ...base, requestedCents: 201 }).decision, 'blocked');
  for (const used of [500, 501, 1000]) {
    const result = evaluate({ ...base, outstandingReservedCreditsUsdCents: used });
    assert.equal(result.capacity.remainingCents, 0);
    assert.equal(result.decision, 'blocked');
  }
});

test('existing 85% utilization queue behavior is unchanged', () => {
  for (const [used, decision] of [[424, 'allowed'], [425, 'queued'], [499, 'queued']]) {
    assert.equal(evaluate({
      startingProviderAllowanceCents: 500,
      outstandingReservedCreditsUsdCents: used,
    }).decision, decision);
  }
  assert.equal(evaluate({
    startingProviderAllowanceCents: 500,
    outstandingReservedCreditsUsdCents: 425,
    requestedCents: 76,
  }).decision, 'blocked');
});

test('any positive real revenue removes the allowance, preserving exactly the old 35% calculation', () => {
  for (const trailingRevenueCents of [1, 100, 1000, 10000]) {
    const baseline = evaluate({ trailingRevenueCents });
    const withAllowance = evaluate({ trailingRevenueCents, startingProviderAllowanceCents: 500 });
    assert.deepEqual(withAllowance, baseline);
    assert.equal(withAllowance.capacity.capCents, Math.round(trailingRevenueCents * 0.35));
  }
  assert.equal(evaluate({
    trailingRevenueCents: 100, startingProviderAllowanceCents: 500, requestedCents: 36,
  }).decision, 'blocked');
});

test('runtime loads only server environment and subtracts all outstanding reservations', async (t) => {
  setAllowance(t, '5000');
  const calls = [];
  const now = Date.parse('2026-10-13T12:00:00Z');
  const signals = await loadRuntimeSafetySignals({
    userId: 'u', requestedCredits: 201, now,
    // Extra caller fields are deliberately ignored.
    startingProviderAllowanceCents: 9999,
    env: { [variable]: '9999' },
    selectRowsFn: async (table, filters) => {
      calls.push({ table, filters });
      if (table === 'credit_reservations' && !filters.user_id) {
        return [{ max_reservation_credits: 100 }, { credits: 200 }];
      }
      assert.notEqual(table, 'app_settings');
      return [];
    },
  });
  assert.equal(signals.exposure.startingProviderAllowanceCents, 500);
  assert.equal(signals.exposure.outstandingReservedCreditsUsdCents, 300);
  assert.equal(evaluateProviderExposure(signals.exposure).decision, 'blocked');
  assert.deepEqual(calls.find(c => c.table === 'revenue_events').filters, {
    created_at: 'gte.2026-09-13T12:00:00.000Z',
  });
  assert.equal(calls.length, 5);
});

test('runtime defaults and malformed environment values fail closed despite caller overrides', async (t) => {
  setAllowance(t, undefined);
  for (const value of [undefined, '0', '500.1', '-1', 'abc']) {
    if (value === undefined) delete process.env[variable];
    else process.env[variable] = value;
    const signals = await loadRuntimeSafetySignals({
      userId: 'u', requestedCredits: 1, selectRowsFn: async () => [],
      startingProviderAllowanceCents: 500,
    });
    assert.equal(signals.exposure.startingProviderAllowanceCents, 0);
    assert.equal(evaluateProviderExposure(signals.exposure).decision, 'blocked');
  }
});
