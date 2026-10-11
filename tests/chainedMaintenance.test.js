const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');

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
      env: {},
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

test('internal URL uses only loopback and the app port, never public URL settings', async () => {
  const { stripeReconcileUrl } = await load();
  assert.equal(stripeReconcileUrl({}).href, 'http://127.0.0.1:3000/api/admin/cron/stripe-reconcile');
  const url = stripeReconcileUrl({
    PORT: '8080',
    HOSTNAME: '0.0.0.0',
    NEXT_PUBLIC_SITE_URL: 'https://cinexvideo.app',
    NEXT_PUBLIC_APP_URL: 'https://cinexvideo.app',
    RAILWAY_PUBLIC_DOMAIN: 'cinexvideo.app',
  });
  assert.equal(url.href, 'http://127.0.0.1:8080/api/admin/cron/stripe-reconcile');
});

test('public scheduler request keeps its authorization and timeout on the loopback call', async () => {
  const { runChainedMaintenance } = await load();
  const authorization = 'Bearer synthetic-cron-token';
  const incoming = new Request('https://cinexvideo.app/api/admin/cron/reconcile', {
    headers: {
      authorization,
      host: 'cinexvideo.app',
      'x-forwarded-host': 'cinexvideo.app',
      'x-forwarded-proto': 'https',
    },
  });
  let fetched = 0;
  const { deps, calls } = makeDeps(async (url, options) => {
    fetched++;
    assert.equal(url.href, 'http://127.0.0.1:8080/api/admin/cron/stripe-reconcile');
    assert.equal(options.method, 'POST');
    assert.deepEqual(options.headers, { authorization });
    assert.equal(options.cache, 'no-store');
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.signal.aborted, false);
    return Response.json({ status: 'ok' });
  });
  deps.env.PORT = '8080';
  const summary = { completed: 2 };
  await runChainedMaintenance(incoming, summary, deps);
  assert.equal(fetched, 1);
  assert.equal(summary.stripe_reconcile, 200);
  assert.equal(summary.completed, 2);
  assert.equal(calls.insert.length, 0);
  assert.equal(calls.del.length, 1);
});

test('invalid ports fail closed without a public fallback and still record backoff', async () => {
  const { runChainedMaintenance, stripeReconcileUrl } = await load();
  for (const port of ['', '0', '-1', '65536', '1.5', '1e3', 'Infinity', '8080@cinexvideo.app', '8080/path']) {
    assert.throws(() => stripeReconcileUrl({ PORT: port }), /Invalid local application port/);
  }
  let fetched = false;
  const { deps, calls } = makeDeps(async () => { fetched = true; throw new Error('must not fetch'); });
  deps.env.PORT = 'super-cron-secret';
  const summary = {};
  await runChainedMaintenance(request, summary, deps);
  assert.equal(fetched, false);
  assert.equal(summary.stripe_reconcile, 'error');
  assert.equal(calls.insert[0].row.status, 'failed');
  assert.equal(calls.del.length, 1);
  assert.equal(JSON.stringify([summary, calls.errors]).includes('super-cron-secret'), false);
});

test('the actual 20-second timer aborts the internal request and preserves backoff', async (t) => {
  const { runChainedMaintenance, STRIPE_RECONCILE_TIMEOUT_MS } = await load();
  assert.equal(STRIPE_RECONCILE_TIMEOUT_MS, 20000);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let started;
  let signal;
  const fetching = new Promise((resolve) => { started = resolve; });
  const { deps, calls } = makeDeps(async (_url, options) => {
    signal = options.signal;
    started();
    return new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  });
  const summary = {};
  const running = runChainedMaintenance(request, summary, deps);
  await fetching;
  t.mock.timers.tick(STRIPE_RECONCILE_TIMEOUT_MS - 1);
  assert.equal(signal.aborted, false);
  t.mock.timers.tick(1);
  await running;
  assert.equal(signal.aborted, true);
  assert.equal(summary.stripe_reconcile, 'timeout');
  assert.equal(calls.insert[0].row.status, 'failed');
  assert.equal(calls.del.length, 1);
});

test('network errors redact the forwarded authorization and preserve generation results', async () => {
  const { runChainedMaintenance } = await load();
  const token = 'synthetic-forwarded-cron-token';
  const incoming = new Request('https://cinexvideo.app/api/admin/cron/reconcile', {
    headers: { authorization: `Bearer ${token}` },
  });
  const { deps, calls } = makeDeps(async () => {
    throw new Error(`fetch failed; authorization=Bearer ${token}; super-cron-secret`);
  });
  const summary = { completed: 3, errors: 0 };
  await runChainedMaintenance(incoming, summary, deps);
  assert.equal(summary.stripe_reconcile, 'error');
  assert.equal(summary.completed, 3);
  assert.equal(summary.errors, 0);
  assert.equal(calls.insert.length, 1);
  assert.equal(calls.del.length, 1);
  const diagnostics = JSON.stringify([summary, calls.errors]);
  assert.equal(diagnostics.includes(token), false);
  assert.equal(diagnostics.includes('super-cron-secret'), false);
});

test('failure backoff still retries exactly at the 15-minute boundary', async () => {
  const { runChainedMaintenance, STRIPE_RECONCILE_EVERY_MS } = await load();
  const now = Date.UTC(2026, 9, 11, 20);
  for (const [age, expectedCalls] of [[STRIPE_RECONCILE_EVERY_MS - 1, 0], [STRIPE_RECONCILE_EVERY_MS, 1]]) {
    let fetched = 0;
    const last = { created_at: new Date(now - age).toISOString() };
    const { deps, calls } = makeDeps(async () => {
      fetched++;
      return Response.json({ status: 'ok' });
    }, last);
    deps.now = () => now;
    await runChainedMaintenance(request, {}, deps);
    assert.equal(fetched, expectedCalls);
    assert.equal(calls.del.length, 1);
  }
});

async function localServer(t, handler) {
  const server = createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  return server.address().port;
}

test('real HTTP request reaches the local listener without resolving the incoming origin', async (t) => {
  const { runChainedMaintenance } = await load();
  const received = [];
  const port = await localServer(t, (incoming, response) => {
    received.push({ method: incoming.method, url: incoming.url, authorization: incoming.headers.authorization });
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end('{"status":"ok"}');
  });
  const incoming = new Request('https://unreachable-public-origin.invalid/api/admin/cron/reconcile', {
    headers: { authorization: 'Bearer local-test-cron-token' },
  });
  const { deps, calls } = makeDeps(fetch);
  deps.env.PORT = String(port);
  const summary = {};
  await runChainedMaintenance(incoming, summary, deps);
  assert.equal(summary.stripe_reconcile, 200);
  assert.deepEqual(received, [{
    method: 'POST', url: '/api/admin/cron/stripe-reconcile', authorization: 'Bearer local-test-cron-token',
  }]);
  assert.equal(calls.insert.length, 0);
});

test('a local redirect cannot forward the cron token to another origin', async (t) => {
  const { runChainedMaintenance } = await load();
  let redirectedRequests = 0;
  const otherPort = await localServer(t, (_request, response) => {
    redirectedRequests++;
    response.end('{"status":"ok"}');
  });
  const port = await localServer(t, (_request, response) => {
    response.writeHead(307, { Location: `http://127.0.0.1:${otherPort}/unexpected` });
    response.end();
  });
  const incoming = new Request('https://unreachable-public-origin.invalid/api/admin/cron/reconcile', {
    headers: { authorization: 'Bearer local-test-cron-token' },
  });
  const { deps, calls } = makeDeps(fetch);
  deps.env.PORT = String(port);
  const summary = {};
  await runChainedMaintenance(incoming, summary, deps);
  assert.equal(redirectedRequests, 0);
  assert.equal(summary.stripe_reconcile, 'error');
  assert.equal(calls.insert[0].row.status, 'failed');
  assert.equal(calls.del.length, 1);
});
