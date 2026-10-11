import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('R2 plan covers Supabase behavior, safe migration, dual reads and rollback prerequisites', async () => {
  const plan = await readFile(new URL('../docs/r2-storage-migration-plan.md', import.meta.url), 'utf8');
  for (const requirement of [
    'Current Supabase Storage behavior',
    'Keys currently use',
    'signed upload URL',
    'CORS',
    'CSP',
    'Quotas, lifecycle, and retention',
    'Dual-read migration and rollout',
    'Rollback',
    'Prerequisites and explicit exclusions',
    'storage_used_bytes',
    'storage_backend',
    '30 consecutive days',
  ]) {
    assert.ok(plan.includes(requirement), `missing storage plan requirement: ${requirement}`);
  }
  assert.match(plan, /Supabase Storage remains the active and default backend/);
  assert.match(plan, /does not create buckets or tokens/);
  assert.doesNotMatch(plan, /AKIA[0-9A-Z]{12,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/);
});

test('CSP only adds a configured HTTPS S3 storage origin and uploads still use Supabase', async () => {
  const middleware = await readFile(new URL('../middleware.js', import.meta.url), 'utf8');
  const uploads = await readFile(new URL('../app/api/uploads/route.js', import.meta.url), 'utf8');
  assert.match(middleware, /process\.env\.STORAGE_S3_ENDPOINT/);
  assert.match(middleware, /url\?\.protocol === 'https:'/);
  assert.match(middleware, /\$\{STORAGE_ORIGIN \? ` \$\{STORAGE_ORIGIN\}` : ''\}/);
  assert.match(uploads, /createSignedUploadUrl\(BUCKET, path\)/);
});
