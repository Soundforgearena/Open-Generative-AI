import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const validatorPath = path.resolve(
  'scripts/validate-production-canary.js'
);
const manifestPath = path.resolve(
  'production-read-canary-v1.json'
);

const validManifest = JSON.parse(
  await readFile(manifestPath, 'utf8')
);

function clone(value) {
  return structuredClone(value);
}

function validate(manifest, expectedEnvironment = 'production') {
  return runValidatorFunction({
    manifest,
    expectedEnvironment,
  });
}

async function runCli({
  environment = 'production',
  promotionUrl,
  promotionToken,
} = {}) {
  const env = {
    ...process.env,
    APP_ENVIRONMENT: environment,
  };

  delete env.PROMOTION_GATE_URL;
  delete env.PROMOTION_GATE_TOKEN;

  if (promotionUrl) {
    env.PROMOTION_GATE_URL = promotionUrl;
  }

  if (promotionToken) {
    env.PROMOTION_GATE_TOKEN = promotionToken;
  }

  const result = await execFileAsync(
    process.execPath,
    [validatorPath, `--manifest=${manifestPath}`],
    { env }
  ).catch((error) => error);

  return result;
}

async function runValidatorFunction({
  manifest,
  expectedEnvironment,
}) {
  const source = await readFile(validatorPath, 'utf8');
  const moduleSource = source
    .replace(/export function validateManifest/g, 'function validateManifest')
    .replace(/export function hashManifest/g, 'function hashManifest')
    .replace(/export async function evaluatePromotionGates/g, 'async function evaluatePromotionGates')
    .replace(/export async function main/g, 'async function main');

  const tempDir = await mkdtemp(
    path.join(os.tmpdir(), 'canary-validator-test-')
  );

  const harnessPath = path.join(tempDir, 'harness.mjs');
  const escapedManifest = JSON.stringify(manifest);
  const escapedEnvironment = JSON.stringify(expectedEnvironment);

  await writeFile(
    harnessPath,
    `${moduleSource}\nprocess.stdout.write(JSON.stringify({\n  validation: validateManifest({ manifest: ${escapedManifest}, expectedEnvironment: ${escapedEnvironment} }),\n  hash: hashManifest(${escapedManifest})\n}));\n`
  );

  const result = await execFileAsync(
    process.execPath,
    [harnessPath],
    { env: process.env }
  );

  await rm(tempDir, { recursive: true, force: true });
  return JSON.parse(result.stdout);
}

test('accepts the production read/play manifest', async () => {
  const result = await validate(validManifest);
  assert.deepEqual(result.validation.errors, []);
});

test('rejects a non-production environment', async () => {
  const manifest = clone(validManifest);
  manifest.environment = 'staging';

  const result = await validate(manifest);

  assert.ok(
    result.validation.errors.includes(
      'Manifest environment must be production.'
    )
  );
});

test('rejects rollout greater than one percent', async () => {
  const manifest = clone(validManifest);
  manifest.rolloutPercent = 1.01;

  const result = await validate(manifest);

  assert.ok(
    result.validation.errors.includes(
      'rolloutPercent must be greater than 0 and no more than 1.'
    )
  );
});

test('rejects actions outside read/play scope', async () => {
  const manifest = clone(validManifest);
  manifest.actions = ['read', 'play', 'upload'];

  const result = await validate(manifest);

  assert.ok(
    result.validation.errors.includes(
      'Initial canary actions must be exactly read and play.'
    )
  );
});

test('rejects destructive purge', async () => {
  const manifest = clone(validManifest);
  manifest.flags.destructive_purge = true;

  const result = await validate(manifest);

  assert.ok(
    result.validation.errors.includes(
      'Flag destructive_purge must be false.'
    )
  );
});

test('rejects provider mutation permission', async () => {
  const manifest = clone(validManifest);
  manifest.safety.allowProviderMutations = true;

  const result = await validate(manifest);

  assert.ok(
    result.validation.errors.includes(
      'safety.allowProviderMutations must be false.'
    )
  );
});

test('manifest hash is stable for unchanged configuration', async () => {
  const first = await validate(validManifest);
  const second = await validate(clone(validManifest));

  assert.equal(first.hash, second.hash);
  assert.match(first.hash, /^[a-f0-9]{64}$/);
});

test('manifest hash changes when rollout changes', async () => {
  const original = await validate(validManifest);
  const changedManifest = clone(validManifest);
  changedManifest.rolloutPercent = 0.5;
  const changed = await validate(changedManifest);

  assert.notEqual(original.hash, changed.hash);
});

test('CLI fails closed without promotion-gate configuration', async () => {
  const result = await runCli();

  assert.equal(result.code, 2);

  const output = JSON.parse(result.stdout.trim());

  assert.equal(output.manifestValid, true);
  assert.equal(output.promotionEligible, false);
  assert.equal(output.applied, false);
  assert.deepEqual(output.sideEffects, []);
});

test('CLI rejects a manifest/environment mismatch', async () => {
  const result = await runCli({
    environment: 'staging',
  });

  assert.equal(result.code, 2);

  const output = JSON.parse(result.stdout.trim());
  assert.equal(output.manifestValid, false);
  assert.equal(output.applied, false);
});

test('validator source contains no mutation boundaries', async () => {
  const source = await readFile(validatorPath, 'utf8');

  for (const pattern of [
    'setEnvironmentFlags',
    'applyApprovedRollout',
    'createCharge',
    'createPayout',
    'deleteObject',
    'deleteFile',
  ]) {
    assert.equal(
      source.includes(pattern),
      false,
      `unexpected mutation symbol: ${pattern}`
    );
  }
});
