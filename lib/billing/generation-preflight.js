// Zero-cost generation preflight: summarises every gate a paid generation
// must pass, without reserving credits or calling the provider.
export function buildPreflightReport({ credits, balance, risk, exposure, providerKeyPresent }) {
  const checks = [
    { id: 'price', label: 'Server price quote', ok: Number.isInteger(credits) && credits > 0,
      detail: `${credits} credits` },
    { id: 'balance', label: 'Credit balance', ok: Number(balance) >= credits,
      detail: `${Number(balance) || 0} available, ${credits} needed` },
    { id: 'risk', label: 'Account safety check', ok: risk?.decision !== 'blocked',
      detail: risk?.decision === 'blocked' ? 'Blocked by safety policy' : 'Clear' },
    { id: 'capacity', label: 'Provider capacity', ok: exposure?.decision === 'allowed',
      detail: exposure?.decision === 'allowed' ? 'Available' : 'Temporarily at capacity' },
    { id: 'provider', label: 'Generation provider configured', ok: Boolean(providerKeyPresent),
      detail: providerKeyPresent ? 'Configured' : 'MUAPI_API_KEY is not set on the server' },
  ];
  return { ready: checks.every((c) => c.ok), credits_required: credits, credits_charged: 0, checks };
}
