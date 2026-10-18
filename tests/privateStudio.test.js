import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { canRead, canWrite, isStale } from '../lib/studio/access.js';

const owner = { id: 'u-owner' };
const other = { id: 'u-other' };
const project = { id: 'p1', owner_id: 'u-owner' };

test('only the owner can change a project', () => {
  assert.equal(canWrite(project, { user: owner }), true);
  assert.equal(canWrite(project, { user: other }), false);
  assert.equal(canWrite(project, { user: other, superAdmin: true }), false);
  assert.equal(canWrite(null, { user: owner }), false);
});

test('super admin may view read-only, other admins and users may not', () => {
  assert.equal(canRead(project, { user: owner }), true);
  assert.equal(canRead(project, { user: other, superAdmin: true }), true);
  assert.equal(canRead(project, { user: other }), false);
  assert.equal(canRead(project, { user: other, superAdmin: false }), false);
});

test('a save based on an older copy is stale', () => {
  assert.equal(isStale('2026-10-18T10:00:05Z', '2026-10-18T10:00:00Z'), true);
  assert.equal(isStale('2026-10-18T10:00:00Z', '2026-10-18T10:00:00Z'), false);
  assert.equal(isStale('2026-10-18T10:00:00Z', undefined), false);
  assert.equal(isStale(null, '2026-10-18T10:00:00Z'), false);
});

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.js') ? [p] : [];
  });
}

test('no project route lets an admin act on another user\'s work', () => {
  const files = walk(new URL('../app/api', import.meta.url).pathname).filter((f) => !f.includes('/admin/'));
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    assert.ok(!/owner_id !== user\.id && !admin/.test(src), `admin bypass left in ${f}`);
  }
});

test('scene saves reject stale copies and Studio merges them', () => {
  const route = readFileSync(new URL('../app/api/scenes/[id]/route.js', import.meta.url), 'utf8');
  assert.match(route, /isStale\(scene\.updated_at, body\.base_updated_at\)/);
  assert.match(route, /code: 'stale'/);
  const studio = readFileSync(new URL('../components/studio/Studio.js', import.meta.url), 'utf8');
  assert.match(studio, /base_updated_at/);
  assert.match(studio, /error\.data\?\.code !== 'stale'/);
  assert.match(studio, /sx-readonly/);
  const proj = readFileSync(new URL('../app/api/projects/[id]/route.js', import.meta.url), 'utf8');
  assert.match(proj, /read_only: !canWrite\(project, \{ user \}\)/);
});
