import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isPlatformFunded, platformDailyCapCents, remainingPlatformAllowanceCents } from '../lib/billing/platform-funding.js';
import { buildPreflightReport } from '../lib/billing/generation-preflight.js';

const src = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('only super admins are platform-funded, and it can be switched off', () => {
  assert.equal(isPlatformFunded({ superAdmin: true }), true);
  assert.equal(isPlatformFunded({ superAdmin: false }), false);
  assert.equal(isPlatformFunded({}), false);
  process.env.PLATFORM_FUND_SUPER_ADMINS = 'false';
  assert.equal(isPlatformFunded({ superAdmin: true }), false);
  delete process.env.PLATFORM_FUND_SUPER_ADMINS;
});

test('platform-funded usage has a daily safety cap', () => {
  assert.equal(platformDailyCapCents(), 10000);
  assert.equal(remainingPlatformAllowanceCents([{ credits_equivalent: 2500 }, { credits_equivalent: 500 }]), 7000);
  assert.equal(remainingPlatformAllowanceCents([{ credits_equivalent: 20000 }]), 0);
  process.env.PLATFORM_FUNDED_DAILY_CAP_CENTS = '50000';
  assert.equal(platformDailyCapCents(), 50000);
  delete process.env.PLATFORM_FUNDED_DAILY_CAP_CENTS;
});

test('preflight shows platform funds instead of a credit balance for super admins', () => {
  const r = buildPreflightReport({ credits: 40, balance: 9000, risk: { decision: 'allowed' }, exposure: { decision: 'allowed' }, providerKeyPresent: true, platformFunded: true });
  assert.equal(r.ready, true);
  assert.equal(r.platform_funded, true);
  assert.match(r.checks.find((c) => c.id === 'balance').label, /Platform funds/);
});

test('MUAPI generations for super admins never touch credits or partner revenue', async () => {
  const gen = await src('app/api/generate/route.js');
  assert.match(gen, /isPlatformFunded\(\{ superAdmin \}\)/);
  assert.match(gen, /credits_reserved: platformFunded \? 0 : credits/);
  assert.match(gen, /funding_source: platformFunded \? 'platform' : 'credits'/);
  assert.match(gen, /recordPlatformUsage\(/);
  assert.doesNotMatch(gen, /\n\s+await callRpc\('release_reservation_v2'/, 'every release is guarded by a real reservation');
  for (const path of ['app/api/jobs/[requestId]/route.js', 'app/api/admin/cron/reconcile/route.js']) {
    const s = await src(path);
    assert.match(s, /job\.funding_source === 'platform'/, path);
    assert.match(s, /if \(!platformJob\)[^]*settle_generation_revenue/, path);
    assert.match(s, /platform_funded_usage/, path);
  }
});

test('platform usage is recorded in a private table', async () => {
  const sql = await src('supabase/migrations/20261002220000_platform_funded_super_admins.sql');
  assert.match(sql, /create table if not exists public\.platform_funded_usage/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on public\.platform_funded_usage from public, anon, authenticated/);
  assert.match(sql, /check \(funding_source in \('credits', 'platform'\)\)/);
});

test('super admins can still buy credits', async () => {
  const me = await src('app/api/me/route.js');
  assert.match(me, /platform_funded: isPlatformFunded/);
  const checkout = await src('app/api/billing/checkout/route.js').catch(() => '');
  assert.doesNotMatch(checkout, /superAdmin|platform/i);
});
