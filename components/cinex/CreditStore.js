'use client';

import { useEffect, useState } from 'react';
import { getCreditPacks, startCheckout } from '@/lib/cinexvideo-client';

const money = (cents) => `$${(cents / 100).toFixed(0)}`;

export default function CreditStore({ notify, onClose }) {
  const [packs, setPacks] = useState(null);
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState('');

  useEffect(() => {
    getCreditPacks()
      .then((data) => {
        setPacks(data.packs);
        setEnabled(data.checkout_enabled);
      })
      .catch((err) => notify(err.message));
  }, [notify]);

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
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <div className="panel-heading">
          <span className="eyebrow">ADD CREDITS</span>
          <button className="icon-button" onClick={onClose}>
            Close
          </button>
        </div>

        {!packs ? (
          <p>Loading…</p>
        ) : !enabled ? (
          <p className="fine-print">
            Credit purchases are not switched on for this deployment yet.
          </p>
        ) : (
          <div className="pack-grid">
            {packs.map((pack) => (
              <div key={pack.code} className={pack.code === best?.code ? 'pack-card featured' : 'pack-card'}>
                {pack.code === best?.code && <span className="pack-flag">BEST VALUE</span>}
                <span className="eyebrow">{pack.name.toUpperCase()}</span>
                <strong>{pack.credits.toLocaleString()}</strong>
                <small>credits</small>
                <p>{pack.blurb}</p>
                <button className="primary full" onClick={() => buy(pack.code)} disabled={Boolean(busy)}>
                  {busy === pack.code ? 'Opening…' : `${money(pack.price_cents)} — Buy`}
                </button>
              </div>
            ))}
          </div>
        )}

        <p className="fine-print">
          Secure payment handled by Stripe. Credits are added to your account the moment
          payment clears, even if you close the tab.
        </p>
      </div>
    </div>
  );
}
