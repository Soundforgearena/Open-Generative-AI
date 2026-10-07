import Link from 'next/link';
import { requireSuperAdmin } from '@/lib/admin/authorize';
import { getSetting, selectRows } from '@/lib/cinexvideo-server';
import EconomicsDashboard from '@/components/admin/EconomicsDashboard';
import CreditPackSimulator from '@/components/admin/CreditPackSimulator';
import SmallPurchaseFeeAnalyzer from '@/components/admin/SmallPurchaseFeeAnalyzer';
import { MARGIN_POLICY } from '@/lib/billing/margin-policy';
import { resolvePaymentMode, stripeSecretKey, stripeWebhookSecret } from '@/lib/billing/payment-mode';
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

export const dynamic = 'force-dynamic';

const CRON_TYPES = 'in.(generation_reconciliation,stripe_reconciliation)';

async function readTable(table, filters = {}, select = '*') {
  try {
    return { name: table, ok: true, rows: await selectRows(table, filters, select) };
  } catch (error) {
    return { name: table, ok: false, rows: [], error };
  }
}

/** Super admin only: real-data profitability cockpit. */
export default async function AdminCockpitPage() {
  await requireSuperAdmin('/admin/cockpit');

  // Every capped read is newest-first, so freshness and recent totals are
  // computed from the latest rows rather than the oldest 5,000.
  const recent = (orderBy) => ({ order: `${orderBy}.desc`, limit: 5000 });
  const [
    wallets,
    payments,
    refunds,
    revenues,
    fees,
    providerCosts,
    jobs,
    cronEvents,
    partners,
    partnerPayouts,
    auditProbe,
    adminActionsProbe,
    splitAuditProbe,
    paymentModeSetting,
    splitSetting,
    packs,
  ] = await Promise.all([
    readTable('credit_wallets', recent('updated_at'), 'balance,updated_at'),
    readTable('payment_records', recent('created_at'), 'id,provider,provider_payment_id,amount_cents,settled_amount_cents,fee_cents,status,created_at'),
    readTable('refund_records', recent('created_at'), 'kind,amount_cents,created_at'),
    readTable('revenue_events', recent('created_at'), 'gross_cents,net_cents,platform_cents,distributed_cents,created_at'),
    readTable('payment_fee_records', recent('recorded_at'), 'payment_record_id,fee_cents,recorded_at'),
    readTable('provider_cost_records', recent('recorded_at'), 'generation_job_id,actual_cost_cents,recorded_at'),
    readTable('generation_requests', recent('created_at'), 'id,status,provider_cost_status,created_at,updated_at'),
    readTable('admin_metric_events', { event_type: CRON_TYPES, order: 'created_at.desc', limit: 200 }, 'event_type,status,created_at'),
    readTable('revenue_partners', { order: 'share_percent.desc' }, 'display_name,email,share_percent,active,payout_provider,stripe_account_id,payouts_enabled,updated_at'),
    readTable('partner_payouts', recent('created_at'), 'status,amount_cents,completed_at,created_at'),
    readTable('financial_audit_events', { order: 'created_at.desc', limit: 1 }, 'created_at'),
    readTable('user_admin_actions', { order: 'created_at.desc', limit: 1 }, 'created_at'),
    readTable('revenue_split_audit', { order: 'created_at.desc', limit: 1 }, 'created_at'),
    getSetting('payment_mode').catch(() => null),
    getSetting('revenue_split').catch(() => null),
    readTable('credit_packs', { active: 'eq.true', order: 'sort_order.asc' }, 'code,name,credits,price_cents'),
  ]);

  const paymentMode = resolvePaymentMode(paymentModeSetting);
  // Check the Stripe keys for the mode customers are actually paying in.
  const stripeEnv = {
    STRIPE_SECRET_KEY: stripeSecretKey(paymentMode),
    STRIPE_WEBHOOK_SECRET: stripeWebhookSecret(paymentMode),
  };
  const cronConfigured = Boolean(process.env.CRON_SECRET?.trim());
  const scheduler = cronSourceStatus({ adminMetricEvents: cronEvents.rows });
  const sources = [
    { name: `Stripe payments and fees (${paymentMode === 'test' ? 'sandbox' : 'live'})`, ...stripeConnectionStatus({ env: stripeEnv, paymentRecords: payments.rows.filter((r) => r.provider !== 'stripe_test'), paymentFeeRecords: fees.rows }) },
    { name: 'MuAPI actual costs', ...muapiConnectionStatus({ providerCostRecords: providerCosts.rows }) },
    { name: 'Supabase finance ledger', ...supabaseFinanceSourceStatus({ wallets: wallets.rows, revenueEvents: revenues.rows, financialAuditEvents: auditProbe.rows }) },
    { name: 'Generation jobs', ...jobsSourceStatus({ jobs: jobs.rows }) },
    { name: 'Reconciliation', ...reconciliationStatus({ paymentRecords: payments.rows, paymentFeeRecords: fees.rows, jobs: jobs.rows, providerCostRecords: providerCosts.rows, adminMetricEvents: cronEvents.rows, cronConfigured }) },
    { name: 'Partner payouts', ...payoutReadinessStatus({ env: { STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || '' }, partners: partners.rows, partnerPayouts: partnerPayouts.rows }) },
    { name: 'Scheduler', ...scheduler },
    { name: 'Database tables', ...migrationReadinessStatus({ checks: [payments, fees, providerCosts, auditProbe, adminActionsProbe, splitAuditProbe, cronEvents, partners] }) },
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

  const activePartners = partners.rows.filter((p) => p.active !== false);
  const platformPercent = Number(splitSetting?.platform_percent ?? 30);
  const distributed = revenues.rows.reduce((sum, r) => sum + Number(r.distributed_cents || 0), 0);
  const platformKept = revenues.rows.reduce((sum, r) => sum + Number(r.platform_cents || 0), 0);
  const paidOut = partnerPayouts.rows.filter((p) => p.status === 'paid').reduce((sum, p) => sum + Number(p.amount_cents || 0), 0);

  return (
    <div className="cinex-admin-overview cinex-admin-cockpit">
      <h1>Economics cockpit</h1>
      <p className="cinex-route-description">
        Live profitability from real payments, AI costs and the revenue ledger. Super admin only; nothing here is shown to other admins or customers.
      </p>

      <EconomicsDashboard
        sources={{ status: sourceStatus, asOf: overallFreshness(sources), items: sources }}
        metrics={metrics}
        scheduler={scheduler}
        policy={{
          targetPercent: MARGIN_POLICY.targetContributionMarginBps / 100,
          floorPercent: MARGIN_POLICY.minimumContributionMarginBps / 100,
          paymentMode,
        }}
        split={{
          platformPercent,
          partners: activePartners.map((p) => ({ name: p.display_name || p.email, percent: Number(p.share_percent) })),
          platformKeptCents: platformKept,
          distributedCents: distributed,
          paidOutCents: paidOut,
        }}
      />
      <CreditPackSimulator packs={packs.rows} floorPercent={MARGIN_POLICY.minimumContributionMarginBps / 100} />
      <SmallPurchaseFeeAnalyzer />
      <p className="cinex-admin-note">
        Change the split or pay partners on <Link href="/admin/connect">Revenue partners</Link>. Every change is recorded in the <Link href="/admin/audit-log">audit log</Link>.
      </p>
    </div>
  );
}
