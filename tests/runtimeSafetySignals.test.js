const test = require('node:test');
const assert = require('node:assert/strict');

const {
  reservedCreditsLastHour,
  countChargebacks,
  trailingRevenueCents,
  outstandingReservedCreditsUsdCents,
  requestedCreditsToUsdCents,
} = require('../lib/billing/runtime-safety-signals.js');
const { buildExportArtifact } = require('../lib/exports/export-artifacts.js');

test('runtime safety sums recent reserved credits only inside the trailing hour', () => {
  const now = Date.parse('2026-09-11T20:00:00.000Z');
  assert.equal(
    reservedCreditsLastHour(
      [
        { created_at: '2026-09-11T19:45:00.000Z', max_reservation_credits: 300 },
        { created_at: '2026-09-11T18:45:00.000Z', max_reservation_credits: 999 },
        { created_at: '2026-09-11T19:59:00.000Z', credits: 25 },
      ],
      now
    ),
    325
  );
});

test('runtime safety counts unique disputes for chargeback blocking', () => {
  assert.equal(
    countChargebacks([
      { kind: 'dispute_created', stripe_dispute_id: 'dp_1' },
      { kind: 'dispute_closed', stripe_dispute_id: 'dp_1' },
      { kind: 'dispute_created', stripe_dispute_id: 'dp_2' },
    ]),
    2
  );
});

test('runtime safety computes trailing revenue and reserved exposure in cents', () => {
  assert.equal(trailingRevenueCents([{ net_cents: 1250 }, { gross_cents: 900 }]), 2150);
  assert.equal(
    outstandingReservedCreditsUsdCents([{ max_reservation_credits: 300 }, { credits: 25 }]),
    325
  );
  assert.equal(requestedCreditsToUsdCents(450), 450);
});

test('exports produce real launchable artifacts', () => {
  const project = { id: 'p1', title: 'Launch trailer', logline: 'Fast launch.' };
  const scenes = [
    {
      id: 's1',
      position: 1,
      title: 'Intro',
      purpose: 'Hook',
      prompt: 'Hero shot',
      duration_seconds: 5,
      status: 'approved',
      active_version: 2,
    },
  ];
  const versions = [
    { scene_id: 's1', version: 2, output_url: 'https://cdn.example/scene-1.mp4', approved: true },
  ];

  const storyboard = buildExportArtifact({
    exportType: 'storyboard',
    project,
    scenes,
    sceneVersions: versions,
  });
  assert.equal(storyboard.extension, 'html');
  assert.match(storyboard.content, /Launch trailer/);

  const clean = buildExportArtifact({
    exportType: 'clean',
    project,
    scenes,
    sceneVersions: versions,
  });
  assert.equal(clean.extension, 'json');
  assert.match(clean.content, /scene-1\.mp4/);
});
