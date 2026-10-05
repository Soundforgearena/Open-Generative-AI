'use client';

import { useEffect, useRef, useState } from 'react';
import { getCreditPacks, getSubscription, startCheckout, startSubscription } from '@/lib/cinexvideo-client';

const money = (cents) => `$${(cents / 100).toFixed(0)}`;

export default function CreditStore({ notify, onClose }) {
  const [packs, setPacks] = useState(null);
  const [enabled, setEnabled] = useState(true);
  const [sandbox, setSandbox] = useState(false);
  const [busy, setBusy] = useState('');
  const [plans, setPlans] = useState([]);
  const [subscription, setSubscription] = useState(null);
  const closeRef = useRef(null);

  useEffect(() => {
    getCreditPacks()
      .then((data) => {
        setPacks(data.packs);
        setEnabled(data.checkout_enabled);
        setSandbox(Boolean(data.sandbox));
      })
      .catch((err) => notify(err.message));
    getSubscription()
      .then((data) => {
        setPlans(data.plans || []);
        setSubscription(data.subscription);
      })
      .catch(() => {});
  }, [notify]);

  useEffect(() => {
    closeRef.current?.focus();
    function handleKey(event) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  async function subscribe(code) {
    setBusy(`plan:${code}`);
    try {
      const { url } = await startSubscription(code);
      window.location.assign(url);
    } catch (err) {
      notify(err.message);
      setBusy('');
    }
  }

  async function buy(code) {
    setBusy(code);
    try {
      const { url } = await startCheckout(code);
      // Full-page redirect to Stripe's hosted page — card details never touch
      // this app.
      window.location.assign(url);
    } catch (err) {
      notify(err.message);
      setBusy('');
    }
  }

  const best = packs?.reduce(
    (top, pack) => (!top || pack.credits_per_dollar > top.credits_per_dollar ? pack : top),
    null
  );

  return (
    <div className="cinex-confirm-backdrop" onClick={onClose}>
      <div
        className="cinex-credit-store"
        role="dialog"
        aria-modal="true"
        aria-labelledby="credit-store-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="cinex-credit-store-header">
          <h2 id="credit-store-title">Add credits</h2>
          <button
            ref={closeRef}
            type="button"
            className="cinex-credit-store-close"
            onClick={onClose}
            aria-label="Close the credit store"
          >
            ×
          </button>
        </div>

        {sandbox && enabled && (
          <p className="cinex-sandbox-banner" role="note">
            Sandbox mode: use Stripe test card 4242 4242 4242 4242 with any future date and CVC. No real money is charged.
          </p>
        )}
        {!packs ? (
          <p className="cinex-credit-store-note" role="status">Loading credit packs...</p>
        ) : !enabled ? (
          <p className="cinex-credit-store-note">
            {sandbox ? 'Credit purchases open soon.' : 'Credit purchases are not switched on for this deployment yet.'}
          </p>
        ) : (
          <ul className="cinex-pack-grid">
            {packs.map((pack) => {
              const isBest = pack.code === best?.code;
              return (
                <li key={pack.code} className={isBest ? 'cinex-pack-card is-best' : 'cinex-pack-card'}>
                  {isBest && <span className="cinex-pack-flag">Best value</span>}
                  <p className="cinex-pack-name">{pack.name}</p>
                  <p className="cinex-pack-credits">
                    <strong>{pack.credits.toLocaleString()}</strong>
                    <span>credits</span>
                  </p>
                  <p className="cinex-pack-blurb">{pack.blurb}</p>
                  <button
                    type="button"
                    className="cinex-route-primary cinex-pack-buy"
                    onClick={() => buy(pack.code)}
                    disabled={Boolean(busy)}
                  >
                    {busy === pack.code ? 'Opening checkout...' : `${money(pack.price_cents)} — Buy`}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {enabled && plans.length > 0 && (
          <>
            <h3 className="cinex-credit-store-subtitle">Monthly plans</h3>
            <p className="cinex-credit-store-note">
              Credits arrive every month and roll over. Cancel any time; you keep every credit you have.
            </p>
            {subscription?.live ? (
              <p className="cinex-credit-store-note" role="status">
                You are on the {plans.find((p) => p.code === subscription.plan_code)?.name || subscription.plan_code} plan.
                Manage it from your account page.
              </p>
            ) : (
              <ul className="cinex-pack-grid">
                {plans.map((plan) => (
                  <li key={plan.code} className="cinex-pack-card">
                    <p className="cinex-pack-name">{plan.name}</p>
                    <p className="cinex-pack-credits">
                      <strong>{plan.included_credits.toLocaleString()}</strong>
                      <span>credits / month</span>
                    </p>
                    <p className="cinex-pack-blurb">{plan.blurb}</p>
                    <button
                      type="button"
                      className="cinex-route-primary cinex-pack-buy"
                      onClick={() => subscribe(plan.code)}
                      disabled={Boolean(busy)}
                    >
                      {busy === `plan:${plan.code}` ? 'Opening checkout...' : `${money(plan.monthly_price_cents)}/mo — Subscribe`}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        <p className="cinex-credit-store-note">
          Secure payment handled by Stripe. Credits are added to your account the moment payment
          clears, even if you close the tab.
        </p>
      </div>
    </div>
  );
}
