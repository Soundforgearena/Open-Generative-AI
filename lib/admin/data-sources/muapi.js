export function muapiConnectionStatus(env = process.env) {
  return {
    connected: Boolean(env.MUAPI_API_KEY),
    status: env.MUAPI_API_KEY ? 'configured' : 'unavailable',
    reason: env.MUAPI_API_KEY
      ? 'Generation settlement records actual MuAPI costs, and the protected catalog cron can warm pricing from active model rules.'
      : 'MUAPI_API_KEY is missing, so provider submissions and status polling are unavailable.',
  };
}

export function normalizeMuapiActual(record) {
  if (!record?.cost) return null;
  return { providerRequestId: record.request_id || record.id || null, model: record.model || null, costCents: Number.isFinite(Number(record.cost.amount_usd)) ? Math.round(Number(record.cost.amount_usd) * 100) : null, credits: Number(record.cost.amount_credits || 0), verified: true };
}
