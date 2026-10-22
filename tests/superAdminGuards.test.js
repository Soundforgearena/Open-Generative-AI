import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../supabase/migrations/20261018173703_super_admin_money_guards.sql', import.meta.url), 'utf8');
const fn = (name) => sql.slice(sql.indexOf(`function public.${name}(`), sql.indexOf('$function$;', sql.indexOf(`function public.${name}(`)));

test('only the super admin can grant credits or cut prices, even directly in the database', () => {
  for (const name of ['admin_grant_bonus', 'admin_set_discount']) {
    assert.match(fn(name), /if not public\.is_cinex_super_admin\(v_admin_id\) then\s+raise exception 'Not authorised'/, name);
    assert.doesNotMatch(fn(name), /is_cinex_admin\(/, name);
  }
  assert.match(fn('admin_grant_bonus'), /p_credits > 10000/);
});

test('admins cannot suspend themselves, other admins or the super admin', () => {
  const body = fn('admin_set_user_active');
  assert.match(body, /p_target_user_id = v_admin_id/);
  assert.match(body, /from public\.admin_members where user_id = p_target_user_id\)\s+and not public\.is_cinex_super_admin/);
});

test('anonymous callers stay locked out', () => {
  for (const sig of ['admin_grant_bonus(uuid, integer, text)', 'admin_set_discount(boolean, numeric, text)', 'admin_set_user_active(uuid, boolean, text)']) {
    assert.ok(sql.includes(`revoke all on function public.${sig} from public, anon;`), sig);
  }
});
