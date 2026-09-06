export function normalizeMuapiCost({ response, headers = {} } = {}) {
  const cost = response?.cost || {};
  const header = (name) => headers[name] || headers[name.toLowerCase()];
  const amountUsd = cost.amount_usd ?? header('X-MuAPI-Cost-USD');
  const amountCredits = cost.amount_credits ?? header('X-MuAPI-Cost-Credits');
  return { amountUsdCents: amountUsd == null ? null : Math.round(Number(amountUsd) * 100), amountCredits: amountCredits == null ? null : Math.round(Number(amountCredits)), bonusCreditsUsed: Number(cost.bonus_credits_used || 0), refunded: Boolean(cost.refunded), providerRequestId: response?.request_id || response?.id || null, model: response?.model || null, units: response?.output_units || null, reliable: Number.isFinite(Number(amountUsd)) || Number.isFinite(Number(amountCredits)) };
}

export function createMockMuapiCostAdapter(costCents = 0) { return { estimate: async () => ({ amountUsdCents: costCents, reliable: true }), normalize: (response) => normalizeMuapiCost({ response: { ...response, cost: { amount_usd: costCents / 100 } } }) }; }
