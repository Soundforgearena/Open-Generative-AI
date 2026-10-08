const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../lib/admin/chained-maintenance.js');

function makeDeps(fetchImpl, last = null) {
  const calls = { insert: [], del: [], errors: [] };
  return {
    calls,
    deps: {
      selectOne: async () => last,
      insertRows: async (table, row) => { calls.insert.push({ table, row }); },
      deleteRows: async (table, filters) => { calls.del.push({ table, filters }); },
      fetchImpl,
      secrets: ['super-cron-secret'],
      logger: { error: (...args) => calls.errors.push(args) },
    },
  };
}

const request = {
  url: 'https://example.com/api/admin/cron/reconcile',
  headers: { get: () => '******' },
};

for (const [status, body] of [[203, '{"error":"proxy"}'], [401, '{"error":"****** denied"}'], [500, '{"error":{"message":"boom sk_live_abcdefghijkl"}}']]) {
  test(`stripe reconcile ${status} is recorded, sanitized, and still prunes`, async () => {
    const { runChainedMaintenance } = await load();
    const { deps, calls } = makeDeps(async () => new Response(body, { status }));
    const summary = { completed: 2 };
    await runChainedMaintenance(request, summary, deps);
    assert.equal(summary.completed, 2);
    assert.equal(summary.stripe_reconcile, status);
    assert.equal(summary.stripe_reconcile_error.status, status);
    const serialized = JSON.stringify([summary, calls.errors]);
    assert.equal(serialized.includes('super-cron-secret'), false);
    assert.equal(serialized.includes('sk_live_abcdefghijkl'), false);
    assert.equal(calls.insert.length, 1);
    assert.equal(calls.insert[0].row.event_type, 'stripe_reconciliation');
    assert.equal(calls.insert[0].row.status, 'failed');
    assert.equal(calls.del.length, 1);
  });
}

test('malformed 200 response is treated as failure', async () => {
  const { runChainedMaintenance } = await load();
  const { deps, calls } = makeDeps(async () => new Response('<html>oops', { status: 200 }));
  const summary = {};
  await runChainedMaintenance(request, summary, deps);
  assert.match(summary.stripe_reconcile_error.body, /malformed/);
  assert.equal(calls.insert.length, 1);
  assert.equal(calls.del.length, 1);
});

test('request timeout is reported and backs off', async () => {
  const { runChainedMaintenance } = await load();
  const { deps, calls } = makeDeps(async () => {
    const e = new Error('The operation was aborted');
    e.name = 'AbortError';
    throw e;
  });
  const summary = {};
  await runChainedMaintenance(request, summary, deps);
  assert.equal(summary.stripe_reconcile, 'timeout');
  assert.equal(calls.insert.length, 1);
  assert.equal(calls.del.length, 1);
});

test('successful response writes no extra event', async () => {
  const { runChainedMaintenance } = await load();
  const { deps, calls } = makeDeps(async () => new Response('{"status":"ok"}', { status: 200 }));
  const summary = {};
  await runChainedMaintenance(request, summary, deps);
  assert.equal(summary.stripe_reconcile, 200);
  assert.equal(summary.stripe_reconcile_error, undefined);
  assert.equal(calls.insert.length, 0);
});

test('no retry storm: recent failed attempt skips Stripe call but still prunes', async () => {
  const { runChainedMaintenance } = await load();
  let fetched = 0;
  const last = { created_at: new Date(Date.now() - 60 * 1000).toISOString() };
  const { deps, calls } = makeDeps(async () => { fetched += 1; return new Response('{}', { status: 500 }); }, last);
  await runChainedMaintenance(request, {}, deps);
  assert.equal(fetched, 0);
  assert.equal(calls.del.length, 1);
});

test('failed attempt older than 15 minutes is retried', async () => {
  const { runChainedMaintenance } = await load();
  let fetched = 0;
  const last = { created_at: new Date(Date.now() - 16 * 60 * 1000).toISOString() };
  const { deps } = makeDeps(async () => { fetched += 1; return new Response('{"status":"ok"}'); }, last);
  await runChainedMaintenance(request, {}, deps);
  assert.equal(fetched, 1);
});

test('prune failure and backoff-write failure do not throw', async () => {
  const { runChainedMaintenance } = await load();
  const { deps } = makeDeps(async () => new Response('{}', { status: 500 }));
  deps.insertRows = async () => { throw new Error('db down'); };
  deps.deleteRows = async () => { throw new Error('db down'); };
  await runChainedMaintenance(request, {}, deps);
});
