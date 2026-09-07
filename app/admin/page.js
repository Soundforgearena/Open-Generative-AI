import Link from 'next/link';
import { requireAdmin } from '@/lib/admin/authorize';
import { selectRows } from '@/lib/cinexvideo-server';
import { ADMIN_SECTIONS } from '@/components/admin/AdminSectionNav';

export const dynamic = 'force-dynamic';

const number = (value) => Number(value || 0).toLocaleString();

/**
 * Admin overview.
 *
 * Reads only records this platform already owns (wallets, reservations,
 * generation requests, catalog and packs) so the landing page shows real
 * operational state instead of placeholder metrics.
 */
async function loadOverview() {
  const [wallets, reservations, jobs, packs, rules] = await Promise.all([
    selectRows('credit_wallets', {}, 'user_id,balance,lifetime_purchased,lifetime_consumed'),
    selectRows('credit_reservations', { status: 'eq.held' }, 'id,credits'),
    selectRows('generation_requests', { order: 'created_at.desc' }, 'id,status,credits_reserved,created_at'),
    selectRows('credit_packs', { active: 'eq.true', order: 'sort_order.asc' }, 'code,name,credits,price_cents'),
    selectRows(
      'model_cost_rules',
      { active: 'eq.true', order: 'operation.asc' },
      'model,operation,customer_label,customer_visible,max_duration_seconds'
    ),
  ]);

  const sum = (rows, key) => rows.reduce((total, row) => total + Number(row[key] || 0), 0);
  const byStatus = jobs.reduce((counts, job) => {
    const status = job.status || 'unknown';
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, {});

  return {
    accounts: wallets.length,
    outstandingCredits: sum(wallets, 'balance'),
    purchasedCredits: sum(wallets, 'lifetime_purchased'),
    consumedCredits: sum(wallets, 'lifetime_consumed'),
    heldReservations: reservations.length,
    heldCredits: sum(reservations, 'credits'),
    jobsTotal: jobs.length,
    jobsByStatus: byStatus,
    recentJobs: jobs.slice(0, 8),
    packs,
    rules,
  };
}

export default async function AdminOverviewPage() {
  await requireAdmin('/admin');

  let overview = null;
  let loadError = '';
  try {
    overview = await loadOverview();
  } catch {
    loadError = 'Live platform records could not be read right now.';
  }

  return (
    <div className="cinex-admin-overview">
      <h1>Admin overview</h1>
      <p className="cinex-route-description">
        Real platform state, read directly from the production records this service owns.
      </p>

      {loadError ? <p className="cinex-form-error" role="alert">{loadError}</p> : null}

      {overview ? (
        <>
          <section aria-labelledby="admin-kpis-title">
            <h2 id="admin-kpis-title">Platform</h2>
            <div className="cinex-admin-kpis">
              <article className="cinex-admin-kpi">
                <span>Accounts with wallets</span>
                <strong>{number(overview.accounts)}</strong>
              </article>
              <article className="cinex-admin-kpi">
                <span>Credits outstanding</span>
                <strong>{number(overview.outstandingCredits)}</strong>
              </article>
              <article className="cinex-admin-kpi">
                <span>Credits purchased to date</span>
                <strong>{number(overview.purchasedCredits)}</strong>
              </article>
              <article className="cinex-admin-kpi">
                <span>Credits consumed to date</span>
                <strong>{number(overview.consumedCredits)}</strong>
              </article>
              <article className="cinex-admin-kpi">
                <span>Credits held in reservations</span>
                <strong>{number(overview.heldCredits)}</strong>
                <small>{number(overview.heldReservations)} open</small>
              </article>
              <article className="cinex-admin-kpi">
                <span>Generation requests</span>
                <strong>{number(overview.jobsTotal)}</strong>
                <small>
                  {Object.entries(overview.jobsByStatus).length
                    ? Object.entries(overview.jobsByStatus).map(([status, count]) => `${status}: ${count}`).join(' · ')
                    : 'none yet'}
                </small>
              </article>
            </div>
          </section>

          <section aria-labelledby="admin-catalog-title">
            <h2 id="admin-catalog-title">Active generation catalog</h2>
            {overview.rules.length ? (
              <table className="cinex-admin-table">
                <thead>
                  <tr>
                    <th scope="col">Customer label</th>
                    <th scope="col">Operation</th>
                    <th scope="col">Provider model</th>
                    <th scope="col">Max duration</th>
                    <th scope="col">Customer visible</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.rules.map((rule) => (
                    <tr key={`${rule.model}-${rule.operation}`}>
                      <td>{rule.customer_label || rule.operation}</td>
                      <td>{rule.operation}</td>
                      <td><code>{rule.model}</code></td>
                      <td>{rule.max_duration_seconds ? `${rule.max_duration_seconds}s` : '—'}</td>
                      <td>{rule.customer_visible ? 'Yes' : 'No'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="cinex-dashboard-empty">No active generation options are configured.</p>
            )}
          </section>

          <section aria-labelledby="admin-packs-title">
            <h2 id="admin-packs-title">Credit packs on sale</h2>
            {overview.packs.length ? (
              <table className="cinex-admin-table">
                <thead>
                  <tr>
                    <th scope="col">Pack</th>
                    <th scope="col">Credits</th>
                    <th scope="col">Price</th>
                    <th scope="col">Credits per dollar</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.packs.map((pack) => (
                    <tr key={pack.code}>
                      <td>{pack.name}</td>
                      <td>{number(pack.credits)}</td>
                      <td>${(pack.price_cents / 100).toFixed(2)}</td>
                      <td>{Math.round((pack.credits / (pack.price_cents / 100)) * 10) / 10}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="cinex-dashboard-empty">No credit packs are active.</p>
            )}
          </section>

          <section aria-labelledby="admin-jobs-title">
            <h2 id="admin-jobs-title">Recent generation requests</h2>
            {overview.recentJobs.length ? (
              <table className="cinex-admin-table">
                <thead>
                  <tr>
                    <th scope="col">Created</th>
                    <th scope="col">Status</th>
                    <th scope="col">Credits reserved</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.recentJobs.map((job) => (
                    <tr key={job.id}>
                      <td>{new Date(job.created_at).toISOString().replace('T', ' ').slice(0, 16)} UTC</td>
                      <td>{job.status}</td>
                      <td>{number(job.credits_reserved)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="cinex-dashboard-empty">No generation requests have been made yet.</p>
            )}
          </section>
        </>
      ) : null}

      <section aria-labelledby="admin-sections-title">
        <h2 id="admin-sections-title">Admin sections</h2>
        <div className="cinex-admin-section-cards">
          {ADMIN_SECTIONS.filter((section) => section.href !== '/admin').map((section) => (
            <Link key={section.href} href={section.href} className="cinex-admin-section-card">
              <strong>{section.label}</strong>
              <span>{section.blurb}</span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
