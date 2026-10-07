import test from 'node:test';
import assert from 'node:assert/strict';
import { CURRENT_SPLIT, validateSplit, splitCents } from '../lib/billing/revenue-split.js';
import { canOnboardCountry, payoutCountries, transferOutcomeUnknown } from '../lib/stripe-connect.js';
import { sectionsForRole } from '../lib/admin/sections.js';

test('October 2026 split: platform 30% + partners 70% of net revenue = 100%', () => {
  assert.equal(CURRENT_SPLIT.platform_percent, 30);
  assert.equal(CURRENT_SPLIT.basis, 'net');
  const total = CURRENT_SPLIT.partners.reduce((s, p) => s + p.share_percent, 0);
  assert.equal(total + CURRENT_SPLIT.platform_percent, 100);
  assert.equal(CURRENT_SPLIT.partners.find((p) => p.role === 'super_admin').share_percent, 40);
  assert.ok(validateSplit({ platformPercent: 30, partners: CURRENT_SPLIT.partners }).ok);
});

test('one entry per person, case-insensitive', () => {
  const emails = CURRENT_SPLIT.partners.map((p) => p.email.toLowerCase());
  assert.equal(new Set(emails).size, emails.length);
});

test('splits that do not add up to 100% are refused', () => {
  const bad = validateSplit({ platformPercent: 30, partners: [{ share_percent: 40 }, { share_percent: 20 }] });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /total 70%/);
  assert.equal(validateSplit({ platformPercent: 130, partners: [] }).ok, false);
  assert.equal(validateSplit({ platformPercent: 30, partners: [{ share_percent: -5 }, { share_percent: 75 }] }).ok, false);
});

test('engine maths pays each partner exactly their share of net, dust to platform', () => {
  const r = splitCents(100_000, { platformPercent: 30, partners: CURRENT_SPLIT.partners });
  const by = Object.fromEntries(r.payouts.map((p) => [p.email, p.amount_cents]));
  assert.equal(by['beatkitbuilder@gmail.com'], 40_000);
  assert.equal(by['kingbeatexclusives@gmail.com'], 10_000);
  assert.equal(by['allygreene82@gmail.com'], 5_000);
  assert.equal(r.platform_cents, 30_000);
  const odd = splitCents(997, { platformPercent: 30, partners: CURRENT_SPLIT.partners });
  assert.equal(odd.platform_cents + odd.payouts.reduce((s, p) => s + p.amount_cents, 0), 997);
});

test('global Stripe Express countries from a Canadian platform', () => {
  for (const c of ['CA', 'US', 'GB', 'DE', 'FR', 'CH', 'IE']) assert.ok(canOnboardCountry(c, {}), c);
  assert.equal(canOnboardCountry('UG', {}), false);
  assert.ok(payoutCountries({}).length >= 30);
});

test('ambiguous Stripe failures are held, not released', () => {
  assert.ok(transferOutcomeUnknown({ type: 'StripeConnectionError' }));
  assert.ok(transferOutcomeUnknown(new Error('socket hang up')));
  assert.equal(transferOutcomeUnknown({ type: 'StripeInvalidRequestError' }), false);
});

test('revenue sections are super admin only', () => {
  const admin = sectionsForRole('admin').map((s) => s.href);
  assert.ok(!admin.includes('/admin/connect') && !admin.includes('/admin/cockpit'));
  const sup = sectionsForRole('super_admin').map((s) => s.href);
  assert.ok(sup.includes('/admin/connect') && sup.includes('/admin/cockpit'));
});
