import { requireAdmin } from '@/lib/admin/authorize';
import { contributionMetricUnavailable } from '@/lib/admin/metrics/contribution-margin';
import { creditLiabilityUnavailable } from '@/lib/admin/metrics/credit-liability';
import { failureCostUnavailable } from '@/lib/admin/metrics/failure-cost';
import { modelProfitabilityUnavailable } from '@/lib/admin/metrics/model-profitability';
import { projectProfitabilityUnavailable } from '@/lib/admin/metrics/project-profitability';
import { operationsHealthUnavailable } from '@/lib/admin/metrics/operations-health';
import { dataQualityUnavailable } from '@/lib/admin/metrics/data-quality';
import { stripeConnectionStatus } from '@/lib/admin/data-sources/stripe';
import { muapiConnectionStatus } from '@/lib/admin/data-sources/muapi';
import { supabaseFinanceSourceStatus } from '@/lib/admin/data-sources/supabase';
import { jobsSourceStatus } from '@/lib/admin/data-sources/jobs';
import { reconciliationStatus } from '@/lib/admin/data-sources/reconciliation';
import EconomicsDashboard from '@/components/admin/EconomicsDashboard';
import CreditPackSimulator from '@/components/admin/CreditPackSimulator';
import SmallPurchaseFeeAnalyzer from '@/components/admin/SmallPurchaseFeeAnalyzer';

export default async function AdminCockpitPage() {
  await requireAdmin('/admin/cockpit');
  const sources = [
    { name: 'Stripe verified payments/fees', ...stripeConnectionStatus() },
    { name: 'MuAPI actual cost/catalog', ...muapiConnectionStatus() },
    { name: 'Supabase finance ledger', ...supabaseFinanceSourceStatus() },
    { name: 'Application jobs/attempts', ...jobsSourceStatus() },
    { name: 'Reconciliation', ...reconciliationStatus() },
  ];
  const sourceStatus = sources.some((source) => source.status === 'unavailable') ? 'unavailable' : sources.some((source) => source.status !== 'verified') ? 'partial' : 'verified';
  const unavailable = { value: null, status: 'unavailable', reason: 'No verified source records are connected.' };
  return <main className="cinex-admin-economics"><h1>Admin Command Center</h1><p>Real-data profitability cockpit. Internal financial data is server-authorized and never sent to ordinary users.</p><EconomicsDashboard sources={{ status: sourceStatus, asOf: null, items: sources }} metrics={{ cash: unavailable, liability: creditLiabilityUnavailable(), margin: contributionMetricUnavailable(), muapi: unavailable, fees: unavailable, jobs: operationsHealthUnavailable(), failures: failureCostUnavailable(), priceAlerts: dataQualityUnavailable() }} /><CreditPackSimulator /><SmallPurchaseFeeAnalyzer /></main>;
}
