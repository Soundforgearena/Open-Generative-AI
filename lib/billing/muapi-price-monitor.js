export function priceDrift(previousCents, currentCents) {
  if (!Number.isFinite(previousCents) || previousCents <= 0) return { changePercent: null, severity: 'info' };
  const changePercent = ((currentCents - previousCents) / previousCents) * 100;
  return { changePercent, severity: Math.abs(changePercent) > 10 ? 'critical' : Math.abs(changePercent) > 5 ? 'warning' : 'info' };
}

export function buildPriceAlert(snapshot) { const drift = priceDrift(snapshot.previousPriceCents, snapshot.currentPriceCents); return { ...snapshot, ...drift, affectedMargins: snapshot.affectedMargins || [] }; }
