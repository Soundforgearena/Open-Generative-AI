import { getBearerUser, isMaintenanceEnabled, requireSecret, callRpc, safeError } from '../../../lib/cinexvideo-server';

export async function POST(request) {
  try {
    if (await isMaintenanceEnabled()) return safeError('Creative services are temporarily unavailable.', 503);
    const user = await getBearerUser(request);
    if (!user) return safeError('Authentication required.', 401);
    const body = await request.json();
    const { provider = 'muapi', model, operation = 'video', provider_cost_cents, duration_seconds = 1, resolution = null, reference_count = 0, input } = body;
    if (!model || !input) return safeError('Generation settings are incomplete.');
    const quote = await callRpc('quote_generation', { p_provider: provider, p_model: model, p_operation: operation, p_provider_cost_cents: provider_cost_cents, p_duration_seconds: duration_seconds, p_resolution: resolution, p_reference_count: reference_count });
    if (!quote.ok || !quote.data?.[0]?.approved) return safeError('This creative setup is temporarily unavailable.', 409);
    const credits = quote.data[0].credits;
    const reference = crypto.randomUUID();
    const reserve = await callRpc('reserve_credits', { p_user_id: user.id, p_credits: credits, p_reference_id: reference });
    if (!reserve.ok || reserve.data !== true) return safeError('You need more credits to continue.', 402);
    try {
      const apiKey = requireSecret('MUAPI_API_KEY');
      const base = process.env.MUAPI_BASE_URL || 'https://api.muapi.ai';
      const providerResponse = await fetch(`${base}/api/v1/${model}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body: JSON.stringify(input) });
      const providerData = await providerResponse.json();
      if (!providerResponse.ok) throw new Error('Generation provider error');
      return Response.json({ request_id: providerData.request_id || providerData.id, credits_reserved: credits, reference }, { status: 202 });
    } catch (providerError) {
      await callRpc('release_credits', { p_user_id: user.id, p_credits: credits, p_reference_id: reference });
      return safeError('Generation could not be started.', 502);
    }
  } catch (error) {
    console.error('generate route', error);
    return safeError('Generation could not be started.', 500);
  }
}
