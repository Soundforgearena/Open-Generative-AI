import assert from 'node:assert/strict';
import test from 'node:test';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://cinexvideo.test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'publishable-key';
process.env.OPENAI_API_KEY = 'openai-key';

const { POST } = await import('../app/api/director/route.js');

const AUTH_USER_ID = '00000000-0000-0000-0000-000000000001';
const BASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;

function json(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function requestBody() {
  return new Request('http://localhost/api/director', {
    method: 'POST',
    headers: {
      Authorization: '******',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      action: 'draftFromScratch',
      field_type: 'scene',
      value: '',
      context: { fieldLabel: 'Scene' },
    }),
  });
}

function createFetchMock(overrides) {
  return async (url, options = {}) => {
    const href = String(url);
    if (href === `${BASE_URL}/auth/v1/user`) return json(200, { id: AUTH_USER_ID });
    if (href.includes('/rest/v1/user_account_status')) return json(200, []);
    if (href.includes('/rest/v1/app_settings')) return json(200, []);
    if (href.includes('/rest/v1/admin_metric_events')) return json(201, [{ id: 1 }]);
    if (href.includes('/rest/v1/rpc/is_cinex_admin')) return json(200, false);
    if (href.includes('/rest/v1/rpc/is_cinex_super_admin')) return json(200, false);
    if (href.includes('/rest/v1/rpc/reserve_credits')) return overrides.onReserve?.(options);
    if (href.includes('/rest/v1/rpc/release_credits')) return overrides.onRelease?.(options);
    if (href.includes('/rest/v1/rpc/consume_credits')) return overrides.onConsume?.(options);
    if (href === 'https://api.openai.com/v1/responses') return overrides.onOpenAi?.(options);
    throw new Error(`Unexpected fetch: ${href}`);
  };
}

test('Director assist returns 402 before OpenAI when credits are insufficient', async () => {
  let openAiCalls = 0;
  let consumeCalls = 0;
  let releaseCalls = 0;
  const originalFetch = global.fetch;
  global.fetch = createFetchMock({
    onReserve: async () => json(200, false),
    onRelease: async () => {
      releaseCalls += 1;
      return json(200, true);
    },
    onConsume: async () => {
      consumeCalls += 1;
      return json(200, true);
    },
    onOpenAi: async () => {
      openAiCalls += 1;
      return json(200, { output_text: '{}' });
    },
  });
  try {
    const response = await POST(requestBody());
    const payload = await response.json();
    assert.equal(response.status, 402);
    assert.match(payload.error, /Insufficient credits for Director assist/i);
    assert.equal(openAiCalls, 0);
    assert.equal(consumeCalls, 0);
    assert.equal(releaseCalls, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test('Director assist releases reservation when model call fails', async () => {
  let releaseCalls = 0;
  let consumeCalls = 0;
  const originalFetch = global.fetch;
  global.fetch = createFetchMock({
    onReserve: async () => json(200, true),
    onRelease: async () => {
      releaseCalls += 1;
      return json(200, true);
    },
    onConsume: async () => {
      consumeCalls += 1;
      return json(200, true);
    },
    onOpenAi: async () => new Response('upstream down', { status: 503 }),
  });
  try {
    const response = await POST(requestBody());
    const payload = await response.json();
    assert.equal(response.status, 502);
    assert.match(payload.error, /temporarily unavailable/i);
    assert.equal(consumeCalls, 0);
    assert.equal(releaseCalls, 1);
  } finally {
    global.fetch = originalFetch;
  }
});
