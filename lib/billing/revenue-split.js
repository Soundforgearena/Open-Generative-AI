// Revenue split: the platform keeps a fixed share and each partner is paid a
// fixed share of the same revenue. Shares are stored as a percent of total
// revenue, so the platform share plus every active partner share must equal
// exactly 100. The database engine (record_revenue) pays each partner
// distributable × share / sum(shares), which equals revenue × share.
//
// Only super admins can read or change this. It is never sent to admins,
// partners or customers.

export const CURRENT_SPLIT = Object.freeze({
  platform_percent: 30,
  basis: 'net', // after provider costs, overhead and Stripe fees
  partners: Object.freeze([
    { email: 'beatkitbuilder@gmail.com', display_name: 'BeatKitBuilder', role: 'super_admin', share_percent: 40 },
    { email: 'kingbeatexclusives@gmail.com', display_name: 'King Beat Exclusives', role: 'admin', share_percent: 10 },
    { email: 'isaiahwalusimbi@gmail.com', display_name: 'Isaiah Walusimbi', role: 'admin', share_percent: 5 },
    { email: 'isaackwalusimbi@gmail.com', display_name: 'Isaac K. Walusimbi', role: 'admin', share_percent: 5 },
    { email: 'allygreene82@gmail.com', display_name: 'Ally Greene', role: 'admin', share_percent: 5 },
    { email: 'officialamaziahmusic@gmail.com', display_name: 'Official Amaziah Music', role: 'admin', share_percent: 5 },
  ]),
});

/** Validates a split. Returns { ok, error, partnerTotal }. */
export function validateSplit({ platformPercent, partners }) {
  const platform = Number(platformPercent);
  if (!Number.isFinite(platform) || platform < 0 || platform > 100) {
    return { ok: false, error: 'Platform share must be between 0% and 100%.' };
  }
  const active = (partners || []).filter((p) => p.active !== false);
  if (active.some((p) => !Number.isFinite(Number(p.share_percent)) || Number(p.share_percent) < 0)) {
    return { ok: false, error: 'Every partner share must be 0% or more.' };
  }
  const partnerTotal = Math.round(active.reduce((sum, p) => sum + Number(p.share_percent || 0), 0) * 100) / 100;
  const expected = Math.round((100 - platform) * 100) / 100;
  if (Math.abs(partnerTotal - expected) > 0.001) {
    return {
      ok: false,
      partnerTotal,
      error: `Partner shares must total ${expected}% so that, with the platform's ${platform}%, the split adds up to 100%. They currently total ${partnerTotal}%.`,
    };
  }
  return { ok: true, partnerTotal };
}

/**
 * Mirrors record_revenue() in the database, in integer cents, so the split
 * can be previewed and tested. Rounding dust stays with the platform.
 */
export function splitCents(baseCents, { platformPercent, partners }) {
  const base = Math.max(0, Math.floor(Number(baseCents) || 0));
  const platform = Math.floor((base * Number(platformPercent)) / 100);
  const distributable = base - platform;
  const active = partners.filter((p) => p.active !== false);
  const totalShare = active.reduce((sum, p) => sum + Number(p.share_percent), 0);
  let assigned = 0;
  const payouts = active.map((p) => {
    const amount = totalShare > 0 ? Math.floor((distributable * Number(p.share_percent)) / totalShare) : 0;
    assigned += amount;
    return { email: p.email, amount_cents: amount };
  });
  return { base_cents: base, platform_cents: platform + (distributable - assigned), payouts };
}
