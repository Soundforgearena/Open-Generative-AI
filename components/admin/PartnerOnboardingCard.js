'use client';

import PayoutSetup from '@/components/payouts/PayoutSetup';

const money = (cents) => `$${((Number(cents) || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Super admin view of one revenue partner: their share of net revenue,
 * balances and Stripe Express connection (with reset).
 */
export default function PartnerOnboardingCard({ partner }) {
  return (
    <div className="cinex-partner-card">
      <div className="cinex-partner-card-head">
        <div>
          <h3>{partner.display_name || partner.email}</h3>
          <p>{partner.email}</p>
        </div>
        <span className="cinex-partner-share">{Number(partner.share_percent)}% <small>of net revenue</small></span>
      </div>
      <dl className="cinex-partner-figures">
        <div><dt>Available</dt><dd>{money(partner.available_cents)}</dd></div>
        <div><dt>Pending payout</dt><dd>{money(partner.pending_payout_cents)}</dd></div>
        <div><dt>Paid out</dt><dd>{money(partner.paid_out_cents)}</dd></div>
        <div><dt>Lifetime</dt><dd>{money(partner.lifetime_earned_cents)}</dd></div>
      </dl>
      <PayoutSetup partnerId={partner.id} compact />
      <p className="cinex-payout-note">Each partner should connect Stripe themselves from the Payouts page while signed in, so the account is in their own name. Use Reset here if they connected the wrong account.</p>
    </div>
  );
}
