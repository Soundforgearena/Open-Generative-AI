import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('browser sessions use Supabase as the only token authority', async () => {
  const client = await read('lib/cinexvideo-client.js');
  assert.doesNotMatch(client, /localStorage\.(getItem|setItem)/);
  assert.match(client, /auth\.getSession\(\)/);
});

test('dashboard data failures do not masquerade as auth failures', async () => {
  const dashboard = await read('app/dashboard/page.js');
  assert.match(dashboard, /if \(!data\.session\)/);
  assert.match(dashboard, /setError\(loadError\.message/);
  assert.doesNotMatch(dashboard, /loadDashboard\(\)\.catch\(\(\) => \{\s*router\.replace/);
  assert.match(dashboard, /href="\/account"/);
});

test('production review invokes the real generation client', async () => {
  const review = await read('app/create/review/page.js');
  assert.match(review, /startGeneration\(\{/);
  assert.match(review, /waitForJob\(/);
  assert.doesNotMatch(review, /Video generation will be available after your account is connected/);
});

test('generation uses one v2 reservation and checks ownership', async () => {
  const route = await read('app/api/generate/route.js');
  assert.equal((route.match(/callRpc\('reserve_credits_v2'/g) || []).length, 1);
  assert.equal((route.match(/callRpc\('reserve_credits'/g) || []).length, 0);
  assert.match(route, /ownedProject\.owner_id !== user\.id/);
  assert.match(route, /Scene does not belong to this project/);
  assert.match(route, /An idempotency key is required/);
  assert.match(route, /canonicalInput/);
  assert.match(route, /duration_seconds: durationSeconds/);
  assert.match(route, /resolution/);
  assert.match(route, /SAFE_PROVIDER_FIELDS/);
  assert.match(route, /images_list/);
  assert.match(route, /audio_url/);
  assert.match(route, /mark_generation_started/);
  assert.match(route, /if \(providerRequestId\)/);
  assert.match(route, /'pixverse-v6': 'pixverse-v6-t2v'/);
  assert.match(route, /'x-api-key': apiKey/);
  assert.equal(route.includes('Authorization:'), false);
  assert.match(route, /quote_only: quoteOnly/);
  assert.match(route, /confirmed_max_credits: confirmedMaxCredits/);
  assert.match(route, /The generation price changed/);
});

test('paid generation requires a distinct confirmation step', async () => {
  const review = await read('app/create/review/page.js');
  assert.match(review, /Review generation/);
  assert.match(review, /Start paid generation\?/);
  assert.match(review, /Start generation/);
  assert.match(review, /setShowGenerationConfirm\(true\)/);
  assert.match(review, /autoFocus/);
  assert.match(review, /event\.key === 'Escape'/);
  assert.match(review, /Maximum debit/);
  assert.match(review, /quoteGeneration/);
  assert.match(review, /confirmed_max_credits/);
});

test('scene edits persist on blur instead of every keystroke', async () => {
  const review = await read('app/create/review/page.js');
  assert.match(review, /onBlur=\{\(\) => persistSceneValue/);
  assert.match(review, /!String\(patch\.title \|\| ''\)\.trim\(\)/);
  assert.doesNotMatch(review, /async function updateSceneValue/);
  assert.match(review, /sceneSaveQueues/);
});

test('all MUAPI provider calls use the provider API key header', async () => {
  const generate = await read('app/api/generate/route.js');
  const jobs = await read('app/api/jobs/[requestId]/route.js');
  const reconcile = await read('app/api/admin/cron/reconcile/route.js');
  for (const route of [generate, jobs, reconcile]) {
    assert.match(route, /'x-api-key': apiKey/);
    assert.equal(route.includes('Authorization:'), false);
  }
});

test('global navigation follows the Supabase auth session', async () => {
  const navigation = await read('components/CinexNavigation.js');
  assert.match(navigation, /auth\.getSession\(\)/);
  assert.match(navigation, /auth\.onAuthStateChange/);
  assert.match(navigation, />Dashboard</);
  assert.match(navigation, />Account</);
  assert.match(navigation, />Sign out</);
});

test('idempotency keys are bound to the original reservation quote', async () => {
  const migration = await read('supabase/migrations/20260907_transaction_integrity_hardening.sql');
  assert.match(migration, /v_existing\.operation is distinct from p_operation/);
  assert.match(migration, /v_existing\.max_reservation_credits is distinct from p_max_reservation_credits/);
  assert.match(migration, /IDEMPOTENCY_KEY_CONFLICT/);
});

test('settled v2 reservations never fall back to legacy accounting', async () => {
  const jobs = await read('app/api/jobs/[requestId]/route.js');
  assert.match(jobs, /if \(reservation\) \{[\s\S]*reservation\.status === 'reserved'/);
  assert.match(jobs, /\} else \{[\s\S]*consume_credits/);
  assert.match(jobs, /\} else \{[\s\S]*release_credits/);
});

test('durable reconciliation settles jobs without a browser poll', async () => {
  const cron = await read('app/api/admin/cron/reconcile/route.js');
  assert.match(cron, /CRON_SECRET/);
  assert.match(cron, /settle_reservation_v2/);
  assert.match(cron, /release_reservation_v2/);
  assert.match(cron, /provider_request_id: 'not\.is\.null'/);
  assert.match(cron, /record_provider_cost_once/);
});

test('legacy direct provider rewrite is removed', async () => {
  const middleware = await read('middleware.js');
  assert.doesNotMatch(middleware, /NextResponse\.rewrite/);
  assert.match(middleware, /signInUrl\.searchParams\.set\('next'/);
});

test('finance migration upgrades the legacy reservation table safely', async () => {
  const migration = await read('supabase/migrations/20260906_finance_safety_controls.sql');
  assert.match(migration, /alter table public\.credit_reservations[\s\S]*add column if not exists operation/);
  assert.match(migration, /where user_id = p_user_id and idempotency_key = p_idempotency_key/);
  assert.match(migration, /grant execute on function public\.reserve_credits_v2/);
  assert.match(migration, /revoke execute on function public\.release_credits/);
  assert.match(migration, /create or replace function public\.adjust_credit_wallet/);
});

test('shared Stripe events are ignored before database access', async () => {
  const webhook = await read('app/api/billing/webhook/route.js');
  const ignorePosition = webhook.indexOf('received: true, ignored: true');
  const storagePosition = webhook.indexOf('supabase = getSupabase()');
  assert.ok(ignorePosition > 0 && storagePosition > ignorePosition);
  assert.match(webhook, /fulfil_credit_purchase/);
  assert.doesNotMatch(webhook, /credit_wallets_add_purchase/);
  assert.match(webhook, /checkout\.session\.async_payment_succeeded/);
  assert.match(webhook, /payment_status/);
  assert.match(webhook, /process_stripe_credit_reversal/);
});

test('Stripe reversals are payment-aware and atomic', async () => {
  const migration = await read('supabase/migrations/20260907_transaction_integrity_hardening.sql');
  assert.match(migration, /refunded_credits integer not null default 0/);
  assert.match(migration, /disputed_credits integer not null default 0/);
  assert.match(migration, /available_credits integer not null default 0/);
  assert.match(migration, /reservation_credit_allocations/);
  assert.match(migration, /payment_records_reversal_exposure_check/);
  assert.match(migration, /create or replace function public\.process_stripe_credit_reversal/);
  assert.match(migration, /p_event_id text/);
  assert.match(migration, /grant execute on function public\.process_stripe_credit_reversal[\s\S]*to service_role/);
  assert.match(migration, /create or replace function public\.record_provider_cost_once/);
  assert.match(migration, /provider_cost_records_generation_job_idx/);
});

test('production hardening migration binds admin helper lookups and locks internal tables', async () => {
  const migration = await read('supabase/migrations/20260911180500_supabase_production_security_hardening.sql');
  assert.match(migration, /create or replace function public\.is_cinex_admin\(p_user_id uuid\)/);
  assert.match(migration, /auth\.role\(\) = 'service_role'/);
  assert.match(migration, /auth\.uid\(\) is not null and p_user_id = auth\.uid\(\)/);
  assert.match(migration, /create or replace function public\.is_cinex_super_admin\(p_user_id uuid\)/);
  for (const tableName of [
    'admin_members',
    'app_settings',
    'user_account_status',
    'credit_wallets',
    'credit_ledger',
    'payment_records',
    'credit_packs',
    'model_cost_rules',
  ]) {
    assert.match(migration, new RegExp(`'${tableName}'`));
  }
  assert.match(migration, /revoke all on table public\.\%I from public, anon, authenticated/);
});

test('admin RPC backfill migration restores audited admin and payout functions', async () => {
  const migration = await read('supabase/migrations/20260911184500_admin_rpc_audit_backfill.sql');
  assert.match(migration, /create table if not exists public\.user_admin_actions/);
  assert.match(migration, /create table if not exists public\.revenue_split_audit/);
  assert.match(migration, /create or replace function public\.admin_grant_bonus\(/);
  assert.match(migration, /create or replace function public\.admin_set_user_active\(/);
  assert.match(migration, /create or replace function public\.admin_set_discount\(/);
  assert.match(migration, /create or replace function public\.admin_set_maintenance\(/);
  assert.match(migration, /create or replace function public\.admin_set_revenue_split\(\s*p_platform_percent numeric,\s*p_basis text,/);
  assert.match(migration, /p_basis not in \('net', 'gross'\)/);
  assert.match(migration, /create or replace function public\.open_partner_payout\(/);
  assert.match(migration, /returns uuid/);
  assert.match(migration, /create or replace function public\.settle_partner_payout\(/);
  assert.match(migration, /auth\.role\(\) <> 'service_role'/);
  assert.match(migration, /grant execute on function public\.admin_set_revenue_split\(numeric, text, text\) to authenticated/);
  assert.match(migration, /grant execute on function public\.settle_partner_payout\(uuid, text, text\) to service_role/);
});
