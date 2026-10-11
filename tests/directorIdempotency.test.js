import test from 'node:test';
import assert from 'node:assert/strict';
import { directorFingerprint, runDirectorOnce } from '../lib/director-idempotency.js';

function setup(run = async () => Response.json({ suggestion: 'Original', credits_charged: 2 })) {
  const rows = new Map();
  let calls = 0;
  const rowKey = (user, key) => `${user}:${key}`;
  const store = {
    async insert(row) {
      const id = rowKey(row.user_id, row.idempotency_key);
      if (rows.has(id)) return { ok: false, data: { code: '23505' } };
      rows.set(id, row);
      return { ok: true };
    },
    async find(filters) { return rows.get(rowKey(filters.user_id.slice(3), filters.idempotency_key.slice(3))); },
    async update(filters, patch) { Object.assign(await this.find(filters), patch); return { ok: true }; },
  };
  const request = {
    userId: 'user-a', key: 'request-a', body: { value: 'original' }, store,
    run: async () => { calls += 1; return run(); },
  };
  return { request, store, calls: () => calls, rows };
}

test('completed request replays original result without another provider call', async () => {
  const state = setup();
  const first = await runDirectorOnce(state.request);
  const retry = await runDirectorOnce(state.request);
  assert.deepEqual(await retry.json(), await first.json());
  assert.equal(retry.headers.get('Idempotency-Replayed'), 'true');
  assert.equal(state.calls(), 1);
});

test('simultaneous duplicate cannot enter the provider twice', async () => {
  let finish;
  const state = setup(() => new Promise((resolve) => { finish = resolve; }));
  const first = runDirectorOnce(state.request);
  const duplicate = await runDirectorOnce(state.request);
  assert.equal(duplicate.status, 409);
  assert.equal((await duplicate.json()).code, 'REQUEST_IN_PROGRESS');
  assert.equal(state.calls(), 1);
  finish(Response.json({ suggestion: 'done' }));
  assert.equal((await first).status, 200);
});

test('changed payload conflicts, and users have isolated request keys', async () => {
  const state = setup();
  await runDirectorOnce(state.request);
  assert.equal((await runDirectorOnce({ ...state.request, body: { value: 'changed' } })).status, 409);
  assert.equal(state.calls(), 1);
  assert.equal((await runDirectorOnce({ ...state.request, userId: 'user-b' })).status, 200);
  assert.equal(state.calls(), 2);
});

test('equivalent object key ordering has the same fingerprint', () => {
  assert.equal(directorFingerprint({ b: 1, a: { y: 2, x: 1 } }), directorFingerprint({ a: { x: 1, y: 2 }, b: 1 }));
  assert.notEqual(directorFingerprint({ a: [1, 2] }), directorFingerprint({ a: [2, 1] }));
});

test('cached provider errors retain status and never run again', async () => {
  const state = setup(async () => Response.json({ error: 'unavailable' }, { status: 502 }));
  assert.equal((await runDirectorOnce(state.request)).status, 502);
  assert.equal((await runDirectorOnce(state.request)).status, 502);
  assert.equal(state.calls(), 1);
});

test('missing migration or storage failure fails closed before spending', async () => {
  const state = setup();
  state.store.insert = async () => ({ ok: false, data: { code: '42P01' } });
  assert.equal((await runDirectorOnce(state.request)).status, 503);
  assert.equal(state.calls(), 0);
});

test('ambiguous provider failure preserves lock across retries', async () => {
  const state = setup(async () => { throw new Error('timeout'); });
  assert.equal((await runDirectorOnce(state.request)).status, 503);
  assert.equal((await runDirectorOnce(state.request)).status, 409);
  assert.equal(state.calls(), 1);
});

test('failed result persistence cannot trigger another charge', async () => {
  const state = setup();
  state.store.update = async () => ({ ok: false });
  assert.equal((await runDirectorOnce(state.request)).status, 503);
  assert.equal((await runDirectorOnce(state.request)).status, 409);
  assert.equal(state.calls(), 1);
});

test('invalid identifiers fail before claims', async () => {
  const state = setup();
  for (const key of ['', 'x'.repeat(201), null]) {
    assert.equal((await runDirectorOnce({ ...state.request, key })).status, 400);
  }
  assert.equal(state.rows.size, 0);
  assert.equal(state.calls(), 0);
});
