import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { providerCostCents } from '../lib/billing/provider-pricing.js';
import { validateUploadDetails } from '../lib/upload-validation.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('dance shots cost $0.10 per second with a 3-second minimum', () => {
  const m = 'kling-v3.0-std-motion-control';
  assert.equal(providerCostCents({ model: m, operation: 'video', durationSeconds: 5, resolution: '1080p', ruleCostCents: 30 }), 50);
  assert.equal(providerCostCents({ model: m, operation: 'video', durationSeconds: 10, resolution: '720p', ruleCostCents: 30 }), 100);
  assert.equal(providerCostCents({ model: m, operation: 'video', durationSeconds: 2, ruleCostCents: 30 }), 30);
});

test('dance clips upload as MP4 or MOV only, up to 60 MB', () => {
  assert.equal(validateUploadDetails({ kind: 'motion', filename: 'uncle.mp4', contentType: 'video/mp4', sizeBytes: 20e6 }).ok, true);
  assert.equal(validateUploadDetails({ kind: 'motion', filename: 'uncle.mov', contentType: 'video/quicktime', sizeBytes: 20e6 }).ok, true);
  assert.equal(validateUploadDetails({ kind: 'motion', filename: 'uncle.jpg', contentType: 'image/jpeg', sizeBytes: 1e6 }).ok, false);
  assert.equal(validateUploadDetails({ kind: 'motion', filename: 'uncle.mp4', contentType: 'video/mp4', sizeBytes: 70 * 1024 * 1024 }).ok, false);
  // Videos are not accepted as ordinary references or faces.
  assert.equal(validateUploadDetails({ kind: 'character', filename: 'a.mp4', contentType: 'video/mp4', sizeBytes: 1e6 }).ok, false);
});

test('migration adds the asset kind, scene columns, bucket types and a hidden price rule', () => {
  const sql = read('supabase/migrations/20261016194450_dance_shots.sql');
  assert.match(sql, /'audio','motion'/);
  assert.match(sql, /motion_asset_id uuid references public\.project_assets\(id\) on delete set null/);
  assert.match(sql, /motion_start_ms integer not null default 0/);
  assert.match(sql, /video\/mp4/);
  assert.match(sql, /'kling-v3\.0-std-motion-control', 'video', 30/);
  assert.doesNotMatch(sql, /(^|[^_a-z])customer_price_cents/);
});

test('generate uses the dance clip only with permission, priced on the scene length', () => {
  const gen = read('app/api/generate/route.js');
  assert.match(gen, /const clip = await sceneMotion\(sc\)/);
  assert.match(gen, /motion \? motion\.seconds/);
  assert.match(gen, /character_orientation: 'video'/);
  assert.match(gen, /keep_original_sound: false/);
  assert.match(gen, /MOTION_TOO_SHORT/);
  assert.match(gen, /engine: perform \? 'perform' : motion \? 'motion'/);
  const motion = read('lib/music/motion.js');
  assert.match(motion, /likeness_consent !== true\) return null/);
  assert.match(motion, /kind: 'eq\.motion'/);
  assert.match(motion, /'-an'/);
});

test('scenes accept only a consented dance clip from the same project', () => {
  const scenes = read('app/api/scenes/[id]/route.js');
  assert.match(scenes, /clip\.kind !== 'motion'/);
  assert.match(scenes, /project_id: `eq\.\$\{scene\.project_id\}`/);
  assert.match(scenes, /clip\.likeness_consent !== true/);
  const uploads = read('app/api/uploads/route.js');
  assert.match(uploads, /kind === 'motion'\) && likenessConsent === true/);
  assert.match(uploads, /motion_asset_id: `eq\.\$\{assetId\}`/);
});

test('Studio never asks for a dance video; dancing is a per-scene beat setting', () => {
  const studio = read('components/studio/Studio.js');
  assert.doesNotMatch(studio, /DancePanel/);
  assert.match(studio, /id="gen-dance" label="Dancing"/);
  assert.match(studio, /<dt>Dance shots<\/dt>/);
});
