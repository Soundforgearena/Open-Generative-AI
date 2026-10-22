import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SRE_POLICY,
  canRetryIncident,
  validateRepairProposal,
} from '../sre/engine/policy.js';

test('repairs cannot target main', () => {
  assert.throws(() => validateRepairProposal({
    branch: 'main',
    files: ['app/page.js'],
    linesChanged: 2,
  }));
});

test('large repairs are rejected', () => {
  assert.throws(() => validateRepairProposal({
    branch: 'sre/fix',
    files: Array(SRE_POLICY.maxChangedFiles + 1).fill('app/page.js'),
    linesChanged: 2,
  }));
});

test('protected paths require human review', () => {
  const result = validateRepairProposal({
    branch: 'sre/fix',
    files: ['app/api/admin/summary/route.js'],
    linesChanged: 10,
  });
  assert.equal(result.requiresHumanReview, true);
});

test('incident retries stop at the configured limit', () => {
  assert.equal(canRetryIncident({
    attempts: SRE_POLICY.maxAttemptsPerIncident,
    cooldownUntil: 0,
    now: Date.now(),
  }), false);
});

test('cooldown blocks immediate retries', () => {
  assert.equal(canRetryIncident({
    attempts: 0,
    cooldownUntil: Date.now() + 60_000,
    now: Date.now(),
  }), false);
});
