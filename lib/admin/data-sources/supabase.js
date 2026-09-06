export function supabaseFinanceSourceStatus(env = process.env) {
  const configured = Boolean(env.SUPABASE_SERVICE_ROLE_KEY && env.NEXT_PUBLIC_SUPABASE_URL);
  return { connected: configured, status: configured ? 'partial' : 'unavailable', reason: configured ? 'Finance table discovery and reconciliation are not configured for this cockpit.' : 'Supabase server configuration is unavailable.' };
}
