import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PERFORM_MODEL } from '../lib/music/likeness.js';
import { providerCostCents } from '../lib/billing/provider-pricing.js';
import { MAX_BUSY_RETRIES } from '../lib/generation/busy-retry.js';

test('sung scenes use Kling Avatar, not OmniHuman', () => {
  assert.equal(PERFORM_MODEL, 'kling-v1-avatar-standard');
  const gen = readFileSync(new URL('../app/api/generate/route.js', import.meta.url), 'utf8');
  assert.ok(!/output_resolution/.test(gen), 'OmniHuman-only field removed');
  const mig = readFileSync(new URL('../supabase/migrations/20261018211152_kling_avatar_singing.sql', import.meta.url), 'utf8');
  assert.match(mig, /'kling-v1-avatar-standard', 'video', 35/);
  assert.match(mig, /set active = false\s+where provider = 'muapi' and model = 'omnihuman-1-5'/);
});

test('Kling is priced per second with a 5 second minimum', () => {
  const c = (s, r = '1080p') => providerCostCents({ model: PERFORM_MODEL, operation: 'video', durationSeconds: s, resolution: r, ruleCostCents: 35 });
  assert.equal(c(7), 49);
  assert.equal(c(3), 35);
  assert.equal(c(7, '720p'), 49);
});

test('busy provider gets about 16 minutes of patience', () => {
  assert.equal(MAX_BUSY_RETRIES, 8);
});
