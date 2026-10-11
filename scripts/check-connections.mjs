// Read-only diagnostics. Never creates accounts, jobs, checkouts or payments.
// --stdin accepts a Railway GraphQL variables response without writing secrets.
let config = process.env;
if (process.argv.includes('--stdin')) {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const parsed = JSON.parse(input);
  if (!parsed.data?.variables) throw new Error('Deployment configuration is unavailable');
  config = parsed.data.variables;
}
const report = { checkedAt: new Date().toISOString(), checks: {} };
async function check(name, url, init = {}, inspect = null) {
  try {
    const response = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(20_000) });
    const text = await response.text();
    let body = null;
    try { body = JSON.parse(text); } catch { /* No raw response logging. */ }
    report.checks[name] = { status: response.status, ...(inspect ? inspect(body) : {}) };
  } catch (error) {
    report.checks[name] = { error: error.name || 'Connection failed' };
  }
}
const supabase = config.NEXT_PUBLIC_SUPABASE_URL;
if (supabase === 'https://xmdgszvkhzgpketayzns.supabase.co') {
  await check('supabase_auth', `${supabase}/auth/v1/settings`, {
    headers: { apikey: config.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '' },
  }, (body) => ({ email: Boolean(body?.external?.email), google: Boolean(body?.external?.google) }));
  await check('supabase_service_role', `${supabase}/rest/v1/projects?select=id&limit=0`, {
    headers: { apikey: config.SUPABASE_SERVICE_ROLE_KEY || '', Authorization: `Bearer ${config.SUPABASE_SERVICE_ROLE_KEY || ''}` },
  });
}
if (config.OPENAI_API_KEY) {
  await check('openai_configured_model', `https://api.openai.com/v1/models/${encodeURIComponent(config.OPENAI_DIRECTOR_MODEL || 'gpt-5.4')}`, {
    headers: { Authorization: `Bearer ${config.OPENAI_API_KEY}` },
  }, (body) => ({ configuredModelAccessible: Boolean(body?.id) }));
}
if (config.MUAPI_API_KEY && (!config.MUAPI_BASE_URL || config.MUAPI_BASE_URL === 'https://api.muapi.ai')) {
  // A deliberately nonexistent request is read-only. 404 is inconclusive:
  // it proves reachability, not successful generation or available balance.
  await check('muapi_read_only_probe', 'https://api.muapi.ai/api/v1/predictions/00000000-0000-4000-8000-000000000000/result', {
    headers: { 'x-api-key': config.MUAPI_API_KEY },
  }, () => ({ generationAndBalanceVerified: false }));
}
for (const mode of ['live', 'test']) {
  const key = config[mode === 'live' ? 'STRIPE_SECRET_KEY' : 'STRIPE_TEST_SECRET_KEY'] || '';
  const secret = mode === 'live'
    ? config.CINEXVIDEO_STRIPE_WEBHOOK_SECRET || config.STRIPE_WEBHOOK_SECRET
    : config.STRIPE_TEST_WEBHOOK_SECRET;
  report.checks[`stripe_${mode}_configuration`] = {
    keyPresent: Boolean(key),
    keyMatchesMode: key.startsWith(`sk_${mode}_`) || key.startsWith(`rk_${mode}_`),
    signingSecretPresent: Boolean(secret),
    transactionTested: false,
  };
}
report.checks.cloud_exports = {
  googleClientConfigured: Boolean(config.NEXT_PUBLIC_GOOGLE_CLIENT_ID),
  dropboxAppConfigured: Boolean(config.NEXT_PUBLIC_DROPBOX_APP_KEY),
};
report.checks.reconciliation = { cronSecretConfigured: Boolean(config.CRON_SECRET), scheduleVerified: false };
const site = config.NEXT_PUBLIC_SITE_URL;
if (site === 'https://cinexvideo.app') {
  await check('production_health', `${site}/api/health`, {}, (body) => ({ ok: body?.ok === true }));
  for (const path of ['/api/me', '/api/admin/summary']) {
    await check(`anonymous_${path}`, `${site}${path}`, {}, () => ({ expectedStatus: 401 }));
  }
}
console.log(JSON.stringify(report, null, 2));
