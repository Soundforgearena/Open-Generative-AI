import { sourceStatus } from './data-sources/freshness.js';

const CRON_EVENT_TYPES = new Set(['generation_reconciliation', 'stripe_reconciliation']);

function readTrimmed(env, key) {
  return typeof env?.[key] === 'string' ? env[key].trim() : '';
}

function latestTimestamp(rows = [], fields = ['created_at']) {
  let latest = null;
  for (const row of rows) {
    for (const field of fields) {
      const value = row?.[field];
      if (!value) continue;
      const time = new Date(value).getTime();
      if (!Number.isFinite(time)) continue;
      if (!latest || time > latest) latest = time;
    }
  }
  return latest ? new Date(latest).toISOString() : null;
}

function money(cents) {
  return `$${(Math.max(0, Number(cents) || 0) / 100).toFixed(2)}`;
}

function integer(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function metric(value, status, reason) {
  return { value, status, reason };
}

function anyWebhookSecret(env) {
  return Boolean(readTrimmed(env, 'STRIPE_WEBHOOK_SECRET') || readTrimmed(env, 'CINEXVIDEO_STRIPE_WEBHOOK_SECRET'));
}

export function stripeConnectionStatus({
  env = process.env,
  paymentRecords = [],
  paymentFeeRecords = [],
} = {}) {
  const configured = Boolean(readTrimmed(env, 'STRIPE_SECRET_KEY') && anyWebhookSecret(env));
  const lastSuccessfulSyncAt = latestTimestamp(paymentFeeRecords, ['recorded_at'])
    || latestTimestamp(paymentRecords, ['created_at']);
  const status = sourceStatus({
    records: paymentFeeRecords.length ? paymentFeeRecords : paymentRecords,
    lastSuccessfulSyncAt,
    sourceConfigured: configured,
    source: 'stripe',
  });
  let reason = status.reason;
  if (configured && paymentRecords.length && !paymentFeeRecords.length) {
    reason = 'Stripe payments exist, but no reconciled fee settlements have been recorded yet.';
  } else if (configured && paymentFeeRecords.length) {
    reason = `${paymentFeeRecords.length} Stripe fee settlement record(s) are available.`;
  }
  return { ...status, connected: configured, reason };
}

export function muapiConnectionStatus({
  env = process.env,
  providerCostRecords = [],
} = {}) {
  const configured = Boolean(readTrimmed(env, 'MUAPI_API_KEY'));
  const lastSuccessfulSyncAt = latestTimestamp(providerCostRecords, ['recorded_at']);
  const status = sourceStatus({
    records: providerCostRecords,
    lastSuccessfulSyncAt,
    sourceConfigured: configured,
    source: 'muapi',
  });
  let reason = status.reason;
  if (configured && providerCostRecords.length) {
    reason = `${providerCostRecords.length} actual MuAPI cost record(s) are available.`;
  }
  return { ...status, connected: configured, reason };
}

export function supabaseFinanceSourceStatus({
  env = process.env,
  wallets = [],
  revenueEvents = [],
  financialAuditEvents = [],
} = {}) {
  const configured = Boolean(readTrimmed(env, 'SUPABASE_SERVICE_ROLE_KEY') && readTrimmed(env, 'NEXT_PUBLIC_SUPABASE_URL'));
  const records = [...wallets, ...revenueEvents, ...financialAuditEvents];
  const lastSuccessfulSyncAt = latestTimestamp(
    [...wallets, ...revenueEvents, ...financialAuditEvents],
    ['updated_at', 'created_at']
  );
  const status = sourceStatus({
    records,
    lastSuccessfulSyncAt,
    sourceConfigured: configured,
    source: 'supabase',
  });
  let reason = status.reason;
  if (configured && records.length) {
    reason = 'Wallet, revenue, and audit records are readable from the live Supabase project.';
  }
  return { ...status, connected: configured, reason };
}

export function jobsSourceStatus({
  jobs = [],
} = {}) {
  const lastSuccessfulSyncAt = latestTimestamp(jobs, ['updated_at', 'created_at']);
  const status = sourceStatus({
    records: jobs,
    lastSuccessfulSyncAt,
    sourceConfigured: true,
    source: 'jobs',
  });
  let reason = status.reason;
  if (jobs.length) {
    reason = 'Generation request records are readable from the live application job tables.';
  }
  return { ...status, connected: true, reason };
}

export function cronSourceStatus({
  env = process.env,
  adminMetricEvents = [],
  now = Date.now(),
} = {}) {
  const configured = Boolean(readTrimmed(env, 'CRON_SECRET'));
  const cronEvents = adminMetricEvents.filter((event) => CRON_EVENT_TYPES.has(event.event_type));
  const lastSuccessfulSyncAt = latestTimestamp(cronEvents, ['created_at']);
  if (!configured) {
    return {
      status: 'unavailable',
      connected: false,
      sourceSystems: ['cron'],
      asOf: null,
      lastSuccessfulSyncAt: null,
      freshnessThreshold: 15 * 60 * 1000,
      reason: 'CRON_SECRET is missing, so protected reconciliation and payout cron routes cannot authenticate.',
    };
  }
  if (!cronEvents.length) {
    return {
      status: 'partial',
      connected: true,
      sourceSystems: ['cron'],
      asOf: new Date(now).toISOString(),
      lastSuccessfulSyncAt: null,
      freshnessThreshold: 15 * 60 * 1000,
      reason: 'CRON_SECRET is configured, but no reconciliation cron activity has been recorded yet.',
    };
  }
  const stale = now - new Date(lastSuccessfulSyncAt).getTime() > 15 * 60 * 1000;
  return {
    status: stale ? 'stale' : 'verified',
    connected: true,
    sourceSystems: ['cron'],
    asOf: new Date(now).toISOString(),
    lastSuccessfulSyncAt,
    freshnessThreshold: 15 * 60 * 1000,
    reason: stale
      ? 'Protected cron activity exists, but the last run is outside the freshness threshold.'
      : 'Protected reconciliation cron activity has been recorded recently.',
  };
}

export function payoutReadinessStatus({
  env = process.env,
  partners = [],
  partnerPayouts = [],
} = {}) {
  const stripeConfigured = Boolean(readTrimmed(env, 'STRIPE_SECRET_KEY'));
  const stripePartners = partners.filter((partner) => partner.payout_provider === 'stripe_express' && partner.active !== false);
  const readyPartners = stripePartners.filter((partner) => partner.stripe_account_id && partner.payouts_enabled);
  const lastSuccessfulSyncAt = latestTimestamp(
    [...partners, ...partnerPayouts],
    ['completed_at', 'updated_at', 'created_at']
  );

  if (!stripePartners.length) {
    return {
      status: 'no_data',
      connected: stripeConfigured,
      sourceSystems: ['payouts'],
      asOf: null,
      lastSuccessfulSyncAt,
      freshnessThreshold: null,
      reason: 'No active Stripe Express payout partners are configured yet.',
    };
  }

  if (!stripeConfigured) {
    return {
      status: 'unavailable',
      connected: false,
      sourceSystems: ['payouts'],
      asOf: null,
      lastSuccessfulSyncAt,
      freshnessThreshold: null,
      reason: 'Stripe is not configured, so partner payouts cannot be sent automatically.',
    };
  }

  const blockedPartners = stripePartners.length - readyPartners.length;
  return {
    status: blockedPartners > 0 ? 'partial' : 'verified',
    connected: true,
    sourceSystems: ['payouts'],
    asOf: new Date().toISOString(),
    lastSuccessfulSyncAt,
    freshnessThreshold: null,
    reason: blockedPartners > 0
      ? `${blockedPartners} Stripe Express partner(s) still need onboarding or payout enablement before automatic payouts are safe.`
      : 'All active Stripe Express partners are payout-ready.',
  };
}

export function migrationReadinessStatus({ checks = [] } = {}) {
  const missing = checks.filter((check) => !check.ok).map((check) => check.name);
  return {
    status: missing.length ? 'partial' : 'verified',
    connected: true,
    sourceSystems: ['supabase'],
    asOf: new Date().toISOString(),
    lastSuccessfulSyncAt: null,
    freshnessThreshold: null,
    reason: missing.length
      ? `The live Supabase project is missing readable migration objects: ${missing.join(', ')}.`
      : 'All required hardening and finance objects are readable in the live Supabase project.',
  };
}

export function reconciliationStatus({
  paymentRecords = [],
  paymentFeeRecords = [],
  jobs = [],
  providerCostRecords = [],
  adminMetricEvents = [],
  cronConfigured = false,
  now = Date.now(),
} = {}) {
  const stripePayments = paymentRecords.filter((record) => record.provider === 'stripe');
  const feeRecordIds = new Set(paymentFeeRecords.map((record) => record.payment_record_id).filter(Boolean));
  const providerCostIds = new Set(providerCostRecords.map((record) => record.generation_job_id).filter(Boolean));
  const missingStripeFees = stripePayments.filter(
    (record) => record.provider_payment_id && !feeRecordIds.has(record.id)
  ).length;
  const missingProviderCosts = jobs.filter(
    (job) =>
      job.status === 'completed'
      && (job.provider_cost_status !== 'recorded' || !providerCostIds.has(job.id))
  ).length;
  const cronEvents = adminMetricEvents.filter((event) => CRON_EVENT_TYPES.has(event.event_type));
  const lastSuccessfulSyncAt = latestTimestamp(cronEvents, ['created_at']);
  const discrepancies = [];
  if (missingStripeFees) discrepancies.push(`${missingStripeFees} Stripe payment(s) are missing reconciled fee rows.`);
  if (missingProviderCosts) discrepancies.push(`${missingProviderCosts} completed job(s) are missing recorded provider costs.`);

  if (!cronConfigured) {
    return {
      status: 'unavailable',
      discrepancies,
      asOf: null,
      lastSuccessfulSyncAt: null,
      reason: 'CRON_SECRET is missing, so reconciliation routes cannot run automatically.',
    };
  }
  if (!stripePayments.length && !jobs.length) {
    return {
      status: 'no_data',
      discrepancies,
      asOf: null,
      lastSuccessfulSyncAt,
      reason: 'No Stripe payments or generation jobs exist yet for reconciliation.',
    };
  }
  if (discrepancies.length) {
    return {
      status: 'partial',
      discrepancies,
      asOf: new Date(now).toISOString(),
      lastSuccessfulSyncAt,
      reason: discrepancies.join(' '),
    };
  }
  if (!lastSuccessfulSyncAt) {
    return {
      status: 'partial',
      discrepancies,
      asOf: new Date(now).toISOString(),
      lastSuccessfulSyncAt: null,
      reason: 'Underlying records exist, but no reconciliation run has been recorded yet.',
    };
  }
  const stale = now - new Date(lastSuccessfulSyncAt).getTime() > 15 * 60 * 1000;
  return {
    status: stale ? 'stale' : 'verified',
    discrepancies,
    asOf: new Date(now).toISOString(),
    lastSuccessfulSyncAt,
    reason: stale
      ? 'Reconciliation last ran outside the freshness threshold.'
      : 'Stripe settlements and provider-cost records are reconciled against current job and payment data.',
  };
}

export function buildCockpitMetrics({
  wallets = [],
  paymentRecords = [],
  refundRecords = [],
  revenueEvents = [],
  paymentFeeRecords = [],
  providerCostRecords = [],
  jobs = [],
} = {}) {
  const settledCashCents = paymentRecords.reduce(
    (total, row) => total + Math.max(0, integer(row.settled_amount_cents || row.amount_cents)),
    0
  );
  const refundedCashCents = refundRecords
    .filter((row) => row.kind === 'refund')
    .reduce((total, row) => total + Math.max(0, integer(row.amount_cents)), 0);
  const outstandingCredits = wallets.reduce((total, row) => total + Math.max(0, integer(row.balance)), 0);
  const grossRevenueCents = revenueEvents.reduce((total, row) => total + Math.max(0, integer(row.gross_cents)), 0);
  const netRevenueCents = revenueEvents.reduce((total, row) => total + Math.max(0, integer(row.net_cents)), 0);
  const providerCostCents = providerCostRecords.reduce(
    (total, row) => total + Math.max(0, integer(row.actual_cost_cents)),
    0
  );
  const feeCents = paymentFeeRecords.reduce((total, row) => total + Math.max(0, integer(row.fee_cents)), 0);
  const activeJobs = jobs.filter((job) => ['queued', 'running'].includes(job.status)).length;
  const failedJobs = new Set(
    jobs.filter((job) => ['failed', 'released'].includes(job.status)).map((job) => job.id)
  );
  const failureCostCents = providerCostRecords.reduce(
    (total, row) => total + (failedJobs.has(row.generation_job_id) ? Math.max(0, integer(row.actual_cost_cents)) : 0),
    0
  );
  const missingFeeRecords = paymentRecords.filter(
    (row) => row.provider === 'stripe' && row.provider_payment_id
  ).length - paymentFeeRecords.length;
  const pendingProviderCosts = jobs.filter((job) => job.provider_cost_status === 'pending').length;

  return {
    cash: paymentRecords.length
      ? metric(money(Math.max(0, settledCashCents - refundedCashCents)), 'verified', 'Settled collections minus recorded refunds.')
      : metric(null, 'no_data', 'No completed customer payments exist yet.'),
    liability: wallets.length
      ? metric(`${Math.round(outstandingCredits).toLocaleString()} credits`, 'verified', 'Outstanding prepaid credits currently held in user wallets.')
      : metric(null, 'no_data', 'No credit wallets exist yet.'),
    margin: revenueEvents.length && grossRevenueCents > 0
      ? metric(`${((netRevenueCents / grossRevenueCents) * 100).toFixed(1)}%`, 'verified', 'Realized net revenue divided by gross revenue from revenue_events.')
      : metric(null, 'no_data', 'No settled revenue events exist yet.'),
    muapi: providerCostRecords.length
      ? metric(money(providerCostCents), 'verified', 'Actual MuAPI provider costs recorded from completed jobs.')
      : metric(null, 'no_data', 'No provider cost records exist yet.'),
    fees: paymentFeeRecords.length
      ? metric(money(feeCents), 'verified', 'Actual Stripe processing fees recorded from balance transactions.')
      : metric(null, 'no_data', 'No Stripe fee settlements exist yet.'),
    jobs: jobs.length
      ? metric(String(activeJobs), 'verified', 'Queued and running generation requests.')
      : metric(null, 'no_data', 'No generation requests exist yet.'),
    failures: providerCostRecords.length
      ? metric(money(failureCostCents), 'verified', 'Provider costs associated with failed or released generation jobs.')
      : metric(null, 'no_data', 'No provider cost records exist yet.'),
    priceAlerts: metric(
      String(Math.max(0, missingFeeRecords) + pendingProviderCosts),
      Math.max(0, missingFeeRecords) + pendingProviderCosts > 0 ? 'partial' : 'verified',
      Math.max(0, missingFeeRecords) + pendingProviderCosts > 0
        ? 'Reconciliation is still catching up on fee settlements or provider-cost records.'
        : 'No outstanding fee-settlement or provider-cost reconciliation alerts are currently visible.'
    ),
  };
}

export function overallFreshness(items = []) {
  return latestTimestamp(items, ['lastSuccessfulSyncAt', 'asOf', 'created_at', 'updated_at']);
}
