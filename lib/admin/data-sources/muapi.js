export function muapiConnectionStatus(env = process.env) {
  return { connected: Boolean(env.MUAPI_API_KEY && env.MUAPI_BASE_URL), status: env.MUAPI_API_KEY && env.MUAPI_BASE_URL ? 'configured' : 'unavailable', reason: 'No verified MuAPI catalog or actual-cost sync is available to this cockpit.' };
}

export function normalizeMuapiActual(record) {
  if (!record?.cost) return null;
  return { providerRequestId: record.request_id || record.id || null, model: record.model || null, costCents: Number.isFinite(Number(record.cost.amount_usd)) ? Math.round(Number(record.cost.amount_usd) * 100) : null, credits: Number(record.cost.amount_credits || 0), verified: true };
}
