const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildCockpitMetrics,
  reconciliationStatus,
  cronSourceStatus,
  payoutReadinessStatus,
  migrationReadinessStatus,
} = require('../lib/admin/cockpit-data.js');

test('cockpit metrics use live finance and job records instead of placeholder unavailable values', () => {
  const metrics = buildCockpitMetrics({
    wallets: [{ balance: 1200 }],
    paymentRecords: [{ provider: 'stripe', settled_amount_cents: 5000, provider_payment_id: 'pi_1' }],
    refundRecords: [{ kind: 'refund', amount_cents: 1000 }],
    revenueEvents: [{ gross_cents: 5000, net_cents: 3200 }],
    paymentFeeRecords: [{ payment_record_id: 'pay_1', fee_cents: 175 }],
    providerCostRecords: [{ generation_job_id: 'job_2', actual_cost_cents: 900 }],
    jobs: [{ id: 'job_1', status: 'running', provider_cost_status: 'pending' }],
  });

  assert.equal(metrics.cash.value, '$40.00');
  assert.equal(metrics.liability.value, '1,200 credits');
  assert.equal(metrics.margin.value, '64.0%');
  assert.equal(metrics.muapi.value, '$9.00');
  assert.equal(metrics.fees.value, '$1.75');
  assert.equal(metrics.jobs.value, '1');
  assert.equal(metrics.priceAlerts.status, 'partial');
});

test('reconciliation status reports live discrepancies and cron freshness', () => {
  const status = reconciliationStatus({
    paymentRecords: [{ id: 'pay_1', provider: 'stripe', provider_payment_id: 'pi_1' }],
    paymentFeeRecords: [],
    jobs: [{ id: 'job_1', status: 'completed', provider_cost_status: 'pending' }],
    providerCostRecords: [],
    adminMetricEvents: [{ event_type: 'stripe_reconciliation', created_at: new Date().toISOString() }],
    cronConfigured: true,
  });

  assert.equal(status.status, 'partial');
  assert.match(status.reason, /missing reconciled fee rows/);
  assert.match(status.reason, /missing recorded provider costs/);
});

test('cron, payout, and migration readiness surface external deployment surprises explicitly', () => {
  const cron = cronSourceStatus({
    env: { CRON_SECRET: 'secret' },
    adminMetricEvents: [],
  });
  assert.equal(cron.status, 'partial');

  const payouts = payoutReadinessStatus({
    env: { STRIPE_SECRET_KEY: 'sk_test_1' },
    partners: [{ payout_provider: 'stripe_express', active: true, stripe_account_id: null, payouts_enabled: false }],
  });
  assert.equal(payouts.status, 'partial');

  const migrations = migrationReadinessStatus({
    checks: [{ name: 'payment_fee_records', ok: true }, { name: 'user_admin_actions', ok: false }],
  });
  assert.equal(migrations.status, 'partial');
  assert.match(migrations.reason, /user_admin_actions/);
});
