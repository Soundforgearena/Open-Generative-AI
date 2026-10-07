import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { sectionsForRole } from '../lib/admin/sections.js';
import { buildCockpitMetrics } from '../lib/admin/cockpit-data.js';

test('admins get Users; split, cockpit and audit log are super admin only', () => {
  const admin = sectionsForRole('admin').map((s) => s.href);
  const sup = sectionsForRole('super_admin').map((s) => s.href);
  assert.ok(admin.includes('/admin/users'));
  for (const href of ['/admin/cockpit', '/admin/connect', '/admin/audit-log']) {
    assert.ok(!admin.includes(href), href);
    assert.ok(sup.includes(href), href);
  }
  assert.deepEqual(sectionsForRole(null).map((s) => s.href).filter((h) => ['/admin/cockpit', '/admin/connect', '/admin/audit-log'].includes(h)), []);
});

test('every admin nav link has a real page', () => {
  for (const { href } of sectionsForRole('super_admin')) {
    const file = href === '/admin' ? 'app/admin/page.js' : `app${href}/page.js`;
    assert.ok(fs.existsSync(file), file);
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /import AdminCockpitPage from '\.\.\/cockpit\/page'/);
  }
});

test('sandbox payments never count as cash', () => {
  const m = buildCockpitMetrics({
    paymentRecords: [
      { provider: 'stripe_test', amount_cents: 5000 },
      { provider: 'stripe', amount_cents: 1000, settled_amount_cents: 1000 },
    ],
  });
  assert.equal(m.cash.value, '$10.00');
  const none = buildCockpitMetrics({ paymentRecords: [{ provider: 'stripe_test', amount_cents: 5000 }] });
  assert.equal(none.cash.value, null);
});

test('middleware gates /admin before rendering and fails closed', () => {
  const src = fs.readFileSync('middleware.js', 'utf8');
  assert.match(src, /adminPath && !adminVerified/);
  assert.match(src, /is_cinex_admin/);
});

test('admins only ever see their own partner share', () => {
  const me = fs.readFileSync('app/api/me/route.js', 'utf8');
  assert.match(me, /user_id: `eq\.\$\{user\.id\}`/);
  const connect = fs.readFileSync('app/api/partners/connect/route.js', 'utf8');
  assert.match(connect, /if \(partnerId && superAdmin\)/);
  for (const route of ['app/api/admin/partners/route.js', 'app/api/admin/payouts/route.js']) {
    const src = fs.readFileSync(route, 'utf8');
    const guards = src.match(/guard\(request[^)]*\)/g) || [];
    assert.ok(guards.length && guards.every((g) => g.includes('requireSuperAdmin: true')), route);
  }
});
