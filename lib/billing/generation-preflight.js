// Zero-cost generation preflight: summarises every gate a paid generation
// must pass, without reserving credits or calling the provider.
export function buildPreflightReport({ credits, balance, risk, exposure, providerKeyPresent, atCost = false }) {
  const checks = [
    { id: 'price', label: 'Server price quote', ok: Number.isInteger(credits) && credits > 0,
      detail: `${credits} credits` },
    atCost
      ? { id: 'balance', label: 'Purchased credits (super admin, at cost)', ok: Number(balance) >= credits,
          detail: `${Number(balance) || 0} purchased credits available, ${credits} needed at cost` }
      : { id: 'balance', label: 'Credit balance', ok: Number(balance) >= credits,
          detail: `${Number(balance) || 0} available, ${credits} needed` },
    { id: 'risk', label: 'Account safety check', ok: risk?.decision !== 'blocked',
      detail: risk?.decision === 'blocked' ? 'Blocked by safety policy' : 'Clear' },
    { id: 'capacity', label: 'Provider capacity', ok: exposure?.decision === 'allowed',
      detail: exposure?.decision === 'allowed' ? 'Available' : 'Temporarily at capacity' },
    { id: 'provider', label: 'Generation provider configured', ok: Boolean(providerKeyPresent),
      detail: providerKeyPresent ? 'Configured' : 'MUAPI_API_KEY is not set on the server' },
  ];
  return { ready: checks.every((c) => c.ok), credits_required: credits, credits_charged: 0, balance: Number(balance) || 0, at_cost: Boolean(atCost), checks };
}

// Combine per-scene reports into one project-level readiness summary.
export function summarizeProjectReadiness(reports) {
  const total = reports.reduce((sum, r) => sum + Number(r.credits_required || 0), 0);
  const balance = reports.length ? Number(reports[0].balance || 0) : 0;
  const problems = new Map();
  for (const r of reports) for (const c of r.checks || []) {
    if (!c.ok && c.id !== 'balance') problems.set(c.id, `${c.label}: ${c.detail}`);
  }
  if (balance < total) problems.set('balance', `Credit balance: ${balance} available, ${total} needed for all scenes`);
  return { ready: reports.length > 0 && problems.size === 0, totalCredits: total, balance, problems: [...problems.values()] };
}
