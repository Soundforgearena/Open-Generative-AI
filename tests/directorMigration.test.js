import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('Director migration executes, is repeatable, locks duplicates and denies client roles', async () => {
  const db = new PGlite();
  try {
    // Minimal pre-existing schema with signatures checked against production.
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create schema auth;
      create table auth.users(id uuid primary key);
      create function public.touch_updated_at() returns trigger language plpgsql as
        $$ begin return new; end $$;
      create function public.cinex_normalize_email(text) returns text language sql as $$ select lower($1) $$;
      create function public.calculate_customer_price(numeric,numeric) returns numeric language sql as $$ select $1 $$;
      create function public.calculate_customer_price(numeric,numeric,numeric,numeric,numeric,numeric,numeric)
        returns numeric language sql as $$ select $1 $$;
    `);
    const sql = await readFile(new URL('../supabase/migrations/20261011080000_director_request_idempotency.sql', import.meta.url), 'utf8');
    await db.exec(sql);
    await db.exec(sql);
    const [security] = (await db.query("select relrowsecurity from pg_class where oid='public.director_requests'::regclass")).rows;
    assert.equal(security.relrowsecurity, true);
    await db.exec(`
      insert into auth.users values ('00000000-0000-4000-8000-000000000001');
      insert into public.director_requests(user_id,idempotency_key,fingerprint)
        values ('00000000-0000-4000-8000-000000000001','same-key','hash');
    `);
    await assert.rejects(db.exec(`
      insert into public.director_requests(user_id,idempotency_key,fingerprint)
        values ('00000000-0000-4000-8000-000000000001','same-key','hash')
    `), (error) => error.code === '23505');
    await assert.rejects(db.exec("update public.director_requests set status='completed'"), (error) => error.code === '23514');
    await db.exec(`update public.director_requests set status='completed',response_status=200,response_body='{"suggestion":"done"}'`);
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query('select * from public.director_requests'), (error) => error.code === '42501');
      await db.exec('reset role');
    }
    const paths = (await db.query("select proconfig from pg_proc where proname in ('touch_updated_at','cinex_normalize_email','calculate_customer_price')")).rows;
    assert.equal(paths.length, 4);
    for (const row of paths) assert.ok(row.proconfig.includes('search_path=public'));
  } finally {
    await db.close();
  }
});
