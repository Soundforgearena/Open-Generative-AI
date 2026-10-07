#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs/promises';

const REQUIRED_FLAGS = {
  webhook_shadow_capture: true,
  entitlement_shadow_calculation: true,
  access_enforcement: true,
  upload_enforcement: false,
  credit_enforcement: false,
  payout_enforcement: false,
  destructive_purge: false,
};

const ALLOWED_ACTIONS = new Set(['read', 'play']);
const REQUIRED_VERSIONS = ['invoiceNormalizer', 'entitlementMapping', 'accessChecker', 'accessGateway', 'reconciliation'];

export function validateManifest({ manifest, expectedEnvironment }) {
  const errors = [];
  const warnings = [];
  if (!manifest || typeof manifest !== 'object') return { errors: ['Manifest must be an object.'], warnings };
  if (manifest.manifestVersion !== 'production-read-canary-v1') errors.push('manifestVersion must be production-read-canary-v1.');
  if (manifest.environment !== expectedEnvironment) errors.push(`Manifest environment must be ${expectedEnvironment}.`);
  if (manifest.phase !== 'read_play_only') errors.push('phase must be read_play_only.');
  const rolloutPercent = Number(manifest.rolloutPercent);
  if (!Number.isFinite(rolloutPercent) || rolloutPercent <= 0 || rolloutPercent > 1) errors.push('rolloutPercent must be greater than 0 and no more than 1.');
  if (!Array.isArray(manifest.actions) || manifest.actions.length !== 2 || !manifest.actions.includes('read') || !manifest.actions.includes('play')) errors.push('Initial canary actions must be exactly read and play.');
  else for (const action of manifest.actions) if (!ALLOWED_ACTIONS.has(action)) errors.push(`Action is not permitted: ${action}.`);
  if (!manifest.flags || typeof manifest.flags !== 'object') errors.push('flags must be an object.');
  else for (const [name, expected] of Object.entries(REQUIRED_FLAGS)) if (manifest.flags[name] !== expected) errors.push(`Flag ${name} must be ${String(expected)}.`);
  if (!manifest.versions || typeof manifest.versions !== 'object') errors.push('versions must be an object.');
  else for (const name of REQUIRED_VERSIONS) if (typeof manifest.versions[name] !== 'string' || !manifest.versions[name].trim()) errors.push(`Missing required version: ${name}.`);
  if (!manifest.cohort || !Array.isArray(manifest.cohort.internalUserIds)) errors.push('cohort.internalUserIds must be an array.');
  if (!manifest.approvalPolicy?.requireIndependentApprover) warnings.push('Independent approver policy is not explicitly enabled.');
  if (manifest.safety?.dryRunOnly !== true) errors.push('safety.dryRunOnly must be true.');
  for (const key of ['allowProviderMutations', 'allowFinancialMutations', 'allowEntitlementMutations', 'allowStorageDeletion']) if (manifest.safety?.[key] !== false) errors.push(`safety.${key} must be false.`);
  return { errors, warnings };
}

export function hashManifest(manifest) {
  return crypto.createHash('sha256').update(JSON.stringify({ manifestVersion: manifest.manifestVersion, environment: manifest.environment, phase: manifest.phase, rolloutPercent: manifest.rolloutPercent, actions: [...manifest.actions].sort(), flags: manifest.flags, versions: manifest.versions, cohort: manifest.cohort, approvalPolicy: manifest.approvalPolicy, safety: manifest.safety })).digest('hex');
}

export async function evaluatePromotionGates({ manifest, environment, env = process.env }) {
  const endpoint = env.PROMOTION_GATE_URL;
  if (!endpoint) return { eligible: false, source: 'unavailable', failures: [{ code: 'promotion_gate_endpoint_missing' }] };
  const token = env.PROMOTION_GATE_TOKEN;
  if (!token) return { eligible: false, source: 'unavailable', failures: [{ code: 'promotion_gate_token_missing' }] };
  let response;
  try {
    response = await fetch(endpoint, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ environment, cohort: manifest.cohort, phase: manifest.phase, rolloutPercent: manifest.rolloutPercent, versions: manifest.versions, dryRun: true }) });
  } catch (error) {
    return { eligible: false, source: 'error', failures: [{ code: 'promotion_gate_request_failed', message: error.message }] };
  }
  let body;
  try { body = await response.json(); } catch { return { eligible: false, source: 'invalid_response', failures: [{ code: 'promotion_gate_invalid_response' }] }; }
  if (!response.ok) return { eligible: false, source: 'http_error', failures: [{ code: 'promotion_gate_http_error', status: response.status }] };
  return { eligible: body.eligible === true, source: 'promotion_gate_service', failures: Array.isArray(body.failures) ? body.failures : [] };
}

export async function main({ argv = process.argv, env = process.env, output = process.stdout } = {}) {
  const manifestPath = argv.find((argument) => argument.startsWith('--manifest='))?.slice('--manifest='.length);
  if (!manifestPath) throw new Error('Usage: --manifest=path/to/production-read-canary-v1.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const environment = env.APP_ENVIRONMENT || 'production';
  const validation = validateManifest({ manifest, expectedEnvironment: environment });
  const promotion = validation.errors.length === 0 ? await evaluatePromotionGates({ manifest, environment, env }) : { eligible: false, source: 'manifest_invalid', failures: [{ code: 'manifest_invalid' }] };
  const result = { validatorVersion: 'production-canary-validator-v1', validatedAt: new Date().toISOString(), manifestPath, manifestHash: hashManifest(manifest), environment, manifestValid: validation.errors.length === 0, errors: validation.errors, warnings: validation.warnings, promotionEligible: promotion.eligible, promotionSource: promotion.source, promotionFailures: promotion.failures, flagsToApply: manifest.flags || null, applied: false, sideEffects: [] };
  output.write(`${JSON.stringify(result)}\n`);
  return { ...result, exitCode: result.manifestValid && result.promotionEligible ? 0 : 2 };
}

if (import.meta.url === `file://${process.argv[1]}`) main().then(({ exitCode }) => { process.exitCode = exitCode; }).catch((error) => { process.stderr.write(`${JSON.stringify({ validatorVersion: 'production-canary-validator-v1', manifestValid: false, promotionEligible: false, applied: false, error: error.message })}\n`); process.exitCode = 2; });
