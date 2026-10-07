const STATUS = {
  verified: ['Live', 'is-ok'],
  no_data: ['No data yet', 'is-muted'],
  partial: ['Needs attention', 'is-warn'],
  stale: ['Out of date', 'is-warn'],
  unavailable: ['Not connected', 'is-bad'],
};

function StatusTag({ status }) {
  const [label, tone] = STATUS[status] || [status, 'is-muted'];
  return <span className={`cinex-status-tag ${tone}`}>{label}</span>;
}

const money = (cents) => `$${(Number(cents || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function ago(iso) {
  if (!iso) return 'never';
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

/** Super admin economics cockpit (server-rendered; no data leaves the server). */
export default function EconomicsDashboard({ sources, metrics, scheduler, policy, split }) {
  const cards = [
    ['Cash collected', metrics.cash, 'After refunds. Sandbox payments excluded.'],
    ['Credits owed to customers', metrics.liability],
    ['Net margin', metrics.margin],
    ['AI provider cost', metrics.muapi],
    ['Stripe fees', metrics.fees],
    ['Jobs running now', metrics.jobs],
    ['Cost of failed jobs', metrics.failures],
    ['Reconciliation alerts', metrics.priceAlerts],
  ];
  const partnerTotal = split.partners.reduce((sum, p) => sum + p.percent, 0);

  return (
    <div className="cinex-economics-dashboard">
      <div className="cinex-economics-status">
        <span>Payments: <strong>{policy.paymentMode === 'test' ? 'Sandbox (test cards)' : 'Live'}</strong></span>
        <span>Margin target <strong>{policy.targetPercent}%</strong>, floor <strong>{policy.floorPercent}%</strong></span>
        <span>Data: <StatusTag status={sources.status} /></span>
        <span>Updated {ago(sources.asOf)}</span>
      </div>

      <div className="cinex-economics-cards">
        {cards.map(([label, metric, hint]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{metric.value === null ? '—' : metric.value}</strong>
            <small>{metric.value === null ? metric.reason : hint || metric.reason}</small>
          </div>
        ))}
      </div>

      <section className="cinex-economics-section" aria-labelledby="split-title">
        <h2 id="split-title">Revenue split (net revenue)</h2>
        <div className="cinex-split-summary">
          <span className="is-platform">Platform {split.platformPercent}%</span>
          {split.partners.map((p) => <span key={p.name}>{p.name} {p.percent}%</span>)}
          <span className={Math.abs(split.platformPercent + partnerTotal - 100) < 0.01 ? '' : 'is-platform'}>Total {split.platformPercent + partnerTotal}%</span>
        </div>
        <div className="cinex-economics-cards is-compact">
          <div><span>Platform kept</span><strong>{money(split.platformKeptCents)}</strong></div>
          <div><span>Earned by partners</span><strong>{money(split.distributedCents)}</strong></div>
          <div><span>Paid to partners</span><strong>{money(split.paidOutCents)}</strong></div>
        </div>
      </section>

      <section className="cinex-economics-section" aria-labelledby="sources-title">
        <h2 id="sources-title">Data sources</h2>
        {sources.items.map((source) => (
          <div className="cinex-economics-source" key={source.name}>
            <strong>{source.name}</strong>
            <StatusTag status={source.status} />
            <small>{source.reason || (source.lastSuccessfulSyncAt ? `Last update ${ago(source.lastSuccessfulSyncAt)}.` : 'Connected.')}</small>
          </div>
        ))}
      </section>

      <section className="cinex-economics-section" aria-labelledby="scheduler-title">
        <h2 id="scheduler-title">Scheduler</h2>
        <p>
          <StatusTag status={scheduler.status} />{' '}
          {scheduler.connected
            ? `Background reconciliation last ran ${ago(scheduler.lastSuccessfulSyncAt)}. It finishes AI jobs, records their real cost, refunds failed jobs, and matches Stripe fees to payments every 15 minutes.`
            : scheduler.reason}
        </p>
      </section>

      <section className="cinex-economics-section" aria-labelledby="policy-title">
        <h2 id="policy-title">How these numbers are calculated</h2>
        <p>
          Figures come only from recorded payments, Stripe fee settlements, actual AI provider costs and the revenue ledger. A card shows &ldquo;—&rdquo; until
          there is real data behind it, so nothing here is an estimate.
        </p>
      </section>
    </div>
  );
}
