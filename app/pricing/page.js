'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import CinexRoutePage from '@/components/CinexRoutePage';
import { getPublicPricing } from '@/lib/cinexvideo-client';

const money = (cents) => `$${(cents / 100).toFixed(2)}`;
const wholeMoney = (cents) => `$${(cents / 100).toFixed(0)}`;

export default function PricingPage() {
  const [pricing, setPricing] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    getPublicPricing()
      .then(setPricing)
      .catch((loadError) => setError(loadError.message || 'Pricing could not be loaded.'));
  }, []);

  const centsPerCredit = pricing?.packs?.length
    ? Math.min(...pricing.packs.map((pack) => pack.cents_per_credit))
    : null;

  const inMoney = (credits) =>
    centsPerCredit === null ? null : `≈ ${money(credits * centsPerCredit)}`;

  return (
    <CinexRoutePage
      eyebrow="Pricing"
      title="Credits, packs and what each action costs"
      description="One credit balance covers everything. You always see the maximum credit debit before a generation starts, and unused reserved credits are returned."
    >
      {error && <p className="cinex-form-error" role="alert">{error}</p>}
      {!pricing && !error && <p className="cinex-form-success" role="status">Loading pricing...</p>}

      {pricing && (
        <>
          {pricing.signup_credits > 0 && (
            <p className="cinex-pricing-highlight">
              New accounts start with {pricing.signup_credits.toLocaleString()} free credits.
            </p>
          )}

          <section className="cinex-pricing-section" aria-labelledby="pricing-packs-title">
            <h2 id="pricing-packs-title">Credit packs</h2>
            <p className="cinex-form-optional">Buy once, use any time. Credits never expire while your account is active.</p>
            <div className="cinex-pricing-grid">
              {pricing.packs.map((pack) => (
                <article
                  key={pack.code}
                  className={pack.code === pricing.best_value_code ? 'cinex-pricing-card is-best' : 'cinex-pricing-card'}
                >
                  {pack.code === pricing.best_value_code && <span className="cinex-pricing-flag">Best value</span>}
                  <h3>{pack.name}</h3>
                  <p className="cinex-pricing-amount">{wholeMoney(pack.price_cents)}</p>
                  <p className="cinex-pricing-credits">{pack.credits.toLocaleString()} credits</p>
                  <p className="cinex-form-optional">{pack.blurb}</p>
                  <dl className="cinex-pricing-facts">
                    <div>
                      <dt>Credits per dollar</dt>
                      <dd>{pack.credits_per_dollar}</dd>
                    </div>
                    <div>
                      <dt>Cost per credit</dt>
                      <dd>{money(pack.cents_per_credit)}</dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>
          </section>

          <section className="cinex-pricing-section" aria-labelledby="pricing-actions-title">
            <h2 id="pricing-actions-title">What each action costs</h2>
            <p className="cinex-form-optional">
              These are live figures from the same pricing engine used when a generation is confirmed.
              {centsPerCredit !== null && ` Money equivalents use the best pack rate of ${money(centsPerCredit)} per credit.`}
            </p>
            <div className="cinex-pricing-table-wrap">
              <table className="cinex-pricing-table">
                <thead>
                  <tr>
                    <th scope="col">Action</th>
                    <th scope="col">Length</th>
                    <th scope="col">Credits</th>
                    <th scope="col">Approx. cost</th>
                  </tr>
                </thead>
                <tbody>
                  {pricing.actions.flatMap((action) =>
                    action.tiers.map((tier) => (
                      <tr key={`${action.label}-${action.operation}-${tier.duration_seconds ?? 'single'}`}>
                        <td>
                          {action.label}
                          <span className="cinex-pricing-unit">{action.unit}</span>
                        </td>
                        <td>{tier.duration_seconds ? `${tier.duration_seconds} seconds` : '—'}</td>
                        <td>{tier.credits.toLocaleString()}</td>
                        <td>{inMoney(tier.credits) || '—'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {pricing.free_actions?.length ? (
              <p className="cinex-form-optional">
                Included at no credit cost: {pricing.free_actions.join(', ').toLowerCase()}.
              </p>
            ) : null}
            {pricing.actions.some((action) => action.max_duration_seconds) && (
              <p className="cinex-form-optional">
                Maximum single-scene length:{' '}
                {Math.max(...pricing.actions.map((action) => Number(action.max_duration_seconds) || 0))} seconds.
                Longer pieces are produced as multiple scenes.
              </p>
            )}
          </section>

          {pricing.plans?.length ? (
            <section className="cinex-pricing-section" aria-labelledby="pricing-plans-title">
              <h2 id="pricing-plans-title">Monthly tiers</h2>
              <div className="cinex-pricing-table-wrap">
                <table className="cinex-pricing-table">
                  <thead>
                    <tr>
                      <th scope="col">Tier</th>
                      <th scope="col">Monthly</th>
                      <th scope="col">Included credits</th>
                      <th scope="col">Extra credits</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pricing.plans.map((plan) => (
                      <tr key={plan.code}>
                        <td>{plan.name}</td>
                        <td>{plan.monthly_price_cents ? wholeMoney(plan.monthly_price_cents) : 'Free'}</td>
                        <td>{plan.included_credits.toLocaleString()}</td>
                        <td>{plan.overage_price_cents ? `${money(plan.overage_price_cents)} each` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          <div className="cinex-dashboard-actions">
            <Link href="/account" className="cinex-route-primary">Add credits</Link>
            <Link href="/create" className="cinex-route-secondary-link">Start a project</Link>
          </div>

          <p className="cinex-form-optional">
            Credits are reserved up to the maximum shown at confirmation. If a generation fails, the reservation is
            released in full — see the <Link href="/refunds">refunds policy</Link>.
          </p>
        </>
      )}
    </CinexRoutePage>
  );
}
