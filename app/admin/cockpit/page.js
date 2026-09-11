import { requireAdmin } from '@/lib/admin/authorize';
import { selectRows } from '@/lib/cinexvideo-server';
import EconomicsDashboard from '@/components/admin/EconomicsDashboard';
import CreditPackSimulator from '@/components/admin/CreditPackSimulator';
import SmallPurchaseFeeAnalyzer from '@/components/admin/SmallPurchaseFeeAnalyzer';
import {
  buildCockpitMetrics,
  cronSourceStatus,
  jobsSourceStatus,
  migrationReadinessStatus,
  muapiConnectionStatus,
  overallFreshness,
  payoutReadinessStatus,
  reconciliationStatus,
  stripeConnectionStatus,
  supabaseFinanceSourceStatus,
} from '@/lib/admin/cockpit-data';

async function readTable(table, filters = {}, select = '*') {
  try {
    return { name: table, ok: true, rows: await selectRows(table, filters, select) };
  } catch (error) {
    return { name: table, ok: false, rows: [], error };
  }
}

export default async function AdminCockpitPage() {
  await requireAdmin('/admin/cockpit');
  const [
    wallets,
    payments,
    refunds,
    revenues,
    fees,
    providerCosts,
    jobs,
    adminMetricEvents,
    partners,
    partnerPayouts,
    paymentFeeProbe,
    providerCostProbe,
    auditProbe,
    adminActionsProbe,
    splitAuditProbe,
  ] = await Promise.all([
    readTable('credit_wallets', { limit: 5000 }, 'balance,updated_at'),
    readTable('payment_records', { limit: 5000 }, 'id,provider,provider_payment_id,amount_cents,settled_amount_cents,fee_cents,status,created_at'),
    readTable('refund_records', { limit: 5000 }, 'kind,amount_cents,created_at'),
    readTable('revenue_events', { limit: 5000 }, 'gross_cents,net_cents,created_at'),
    readTable('payment_fee_records', { limit: 5000 }, 'payment_record_id,fee_cents,recorded_at'),
    readTable('provider_cost_records', { limit: 5000 }, 'generation_job_id,actual_cost_cents,recorded_at'),
    readTable('generation_requests', { limit: 5000 }, 'id,status,provider_cost_status,created_at,updated_at'),
    readTable('admin_metric_events', { limit: 5000 }, 'event_type,status,created_at'),
    readTable('revenue_partners', { limit: 5000 }, 'active,payout_provider,stripe_account_id,payouts_enabled,updated_at'),
    readTable('partner_payouts', { limit: 5000 }, 'status,completed_at,created_at'),
    readTable('payment_fee_records', { limit: 1 }, 'payment_record_id'),
    readTable('provider_cost_records', { limit: 1 }, 'generation_job_id'),
    readTable('financial_audit_events', { limit: 1 }, 'created_at'),
    readTable('user_admin_actions', { limit: 1 }, 'created_at'),
    readTable('revenue_split_audit', { limit: 1 }, 'changed_at'),
  ]);

  const cronConfigured = Boolean(process.env.CRON_SECRET?.trim());
  const sources = [
    { name: 'Stripe verified payments/fees', ...stripeConnectionStatus({ paymentRecords: payments.rows, paymentFeeRecords: fees.rows }) },
    { name: 'MuAPI actual cost/catalog', ...muapiConnectionStatus({ providerCostRecords: providerCosts.rows }) },
    { name: 'Supabase finance ledger', ...supabaseFinanceSourceStatus({ wallets: wallets.rows, revenueEvents: revenues.rows, financialAuditEvents: auditProbe.rows }) },
    { name: 'Application jobs/attempts', ...jobsSourceStatus({ jobs: jobs.rows }) },
    { name: 'Reconciliation', ...reconciliationStatus({ paymentRecords: payments.rows, paymentFeeRecords: fees.rows, jobs: jobs.rows, providerCostRecords: providerCosts.rows, adminMetricEvents: adminMetricEvents.rows, cronConfigured }) },
    { name: 'Partner payout readiness', ...payoutReadinessStatus({ partners: partners.rows, partnerPayouts: partnerPayouts.rows }) },
    { name: 'Scheduler authorization', ...cronSourceStatus({ adminMetricEvents: adminMetricEvents.rows }) },
    { name: 'Live schema parity', ...migrationReadinessStatus({ checks: [paymentFeeProbe, providerCostProbe, auditProbe, adminActionsProbe, splitAuditProbe] }) },
  ];
  const sourceStatus = sources.some((source) => source.status === 'unavailable')
    ? 'unavailable'
    : sources.some((source) => !['verified', 'no_data'].includes(source.status))
      ? 'partial'
      : 'verified';
  const metrics = buildCockpitMetrics({
    wallets: wallets.rows,
    paymentRecords: payments.rows,
    refundRecords: refunds.rows,
    revenueEvents: revenues.rows,
    paymentFeeRecords: fees.rows,
    providerCostRecords: providerCosts.rows,
    jobs: jobs.rows,
  });
  return <main className="cinex-admin-economics"><h1>Admin Command Center</h1><p>Real-data profitability cockpit. Internal financial data is server-authorized and never sent to ordinary users.</p><EconomicsDashboard sources={{ status: sourceStatus, asOf: overallFreshness(sources), items: sources }} metrics={metrics} /><CreditPackSimulator /><SmallPurchaseFeeAnalyzer /></main>;
}
