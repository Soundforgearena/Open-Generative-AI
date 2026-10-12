import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateProviderExposure,
  normalizeExposureFloorCents,
  DEFAULT_EXPOSURE_FLOOR_CENTS,
  MAX_EXPOSURE_FLOOR_CENTS,
} from '../lib/billing/provider-exposure-guard.js';
import { loadRuntimeSafetySignals } from '../lib/billing/runtime-safety-signals.js';

test('no revenue and no allowance blocks every generation', () => {
  const r = evaluateProviderExposure({ trailingRevenueCents: 0, outstandingReservedCreditsUsdCents: 0, requestedCents: 101 });
  assert.notEqual(r.decision, 'allowed');
});

test('starting allowance lets a small generation run before revenue exists', () => {
  const r = evaluateProviderExposure({ trailingRevenueCents: 0, outstandingReservedCreditsUsdCents: 0, requestedCents: 101, floorCents: 500 });
  assert.equal(r.decision, 'allowed');
  assert.equal(r.capacity.capCents, 500);
});

test('allowance still blocks requests beyond what is left', () => {
  const r = evaluateProviderExposure({ trailingRevenueCents: 0, outstandingReservedCreditsUsdCents: 404, requestedCents: 101, floorCents: 500 });
  assert.equal(r.decision, 'blocked');
});

test('revenue-based cap wins once it exceeds the allowance', () => {
  const r = evaluateProviderExposure({ trailingRevenueCents: 10000, outstandingReservedCreditsUsdCents: 0, requestedCents: 101, floorCents: 500 });
  assert.equal(r.capacity.capCents, 3500);
});

test('allowance is hard-capped and rejects bad values', () => {
  assert.equal(normalizeExposureFloorCents(undefined), DEFAULT_EXPOSURE_FLOOR_CENTS);
  assert.equal(normalizeExposureFloorCents({ cents: 999999 }), MAX_EXPOSURE_FLOOR_CENTS);
  assert.equal(normalizeExposureFloorCents({ cents: -5 }), 0);
  assert.equal(normalizeExposureFloorCents({ cents: 'abc' }), 0);
  assert.equal(normalizeExposureFloorCents({ cents: 0 }), 0);
  const r = evaluateProviderExposure({ trailingRevenueCents: 0, outstandingReservedCreditsUsdCents: 0, requestedCents: 101, floorCents: 10 ** 9 });
  assert.equal(r.capacity.capCents, MAX_EXPOSURE_FLOOR_CENTS);
});

function stubRows(floorBehavior) {
  return async (table, filters) => {
    if (table === 'app_settings') {
      if (floorBehavior === 'throw') throw new Error('db down');
      return floorBehavior;
    }
    return [];
  };
}

test('signals use the stored allowance, the default when unset, and fail closed when unreadable', async () => {
  const base = { userId: 'u', requestedCredits: 101, selectOneFn: async () => null };
  const set = await loadRuntimeSafetySignals({ ...base, selectRowsFn: stubRows([{ value: { cents: 250 } }]) });
  assert.equal(set.exposure.floorCents, 250);
  const unset = await loadRuntimeSafetySignals({ ...base, selectRowsFn: stubRows([]) });
  assert.equal(unset.exposure.floorCents, DEFAULT_EXPOSURE_FLOOR_CENTS);
  const broken = await loadRuntimeSafetySignals({ ...base, selectRowsFn: stubRows('throw') });
  assert.equal(broken.exposure.floorCents, 0);
});
