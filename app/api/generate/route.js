import { getBearerUser, getAdminSupabase, isMaintenanceEnabled, requireSecret } from '../../../lib/cinexvideo-server';

export async function POST(request) {
  try {
    if (await isMaintenanceEnabled()) return Response.json({ error: 'Creative services are temporarily unavailable.' }, { status: 503 });
    const user = await getBearerUser(request);
    if (!user) return Response.json({ error: 'Authentication required.' }, { status: 401 });
    const body = await request.json();
    const { provider = 'muapi', model, operation = 'video', provider_cost_cents, duration_seconds = 1, resolution = null, reference_count = 0, input } = body;
    if (!model || !input) return Response.json({ error: 'Generation settings are incomplete.' }, { status: 400 });
    const supabase = getAdminSupabase();
    const { data: quote, error: quoteError } = await supabase.rpc('quote_generation', { p_provider: provider, p_model: model, p_operation: operation, p_provider_cost_cents: provider_cost_cents, p_duration_seconds: duration_seconds, p_resolution: resolution, p_reference_count: reference_count });
    if (quoteError || !quote?.[0]?.approved) return Response.json({ error: 'This creative setup is temporarily unavailable.' }, { status: 409 });
    const credits = quote[0].credits;
    const reference = crypto.randomUUID();
    const { data: reserved, error: reserveError } = await supabase.rpc('reserve_credits', { p_user_id: user.id, p_credits: credits, p_reference_id: reference });
    if (reserveError || reserved !== true) return Response.json({ error: 'You need more credits to continue.' }, { status: 402 });
    try {
      const apiKey = requireSecret('MUAPI_API_KEY');
      const base = process.env.MUAPI_BASE_URL || 'https://api.muapi.ai';
      const providerResponse = await fetch(`${base}/api/v1/${model}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body: JSON.stringify(input) });
      const providerData = await providerResponse.json();
      if (!providerResponse.ok) throw new Error('Generation provider error');
      return Response.json({ request_id: providerData.request_id || providerData.id, credits_reserved: credits, reference }, { status: 202 });
    } catch (providerError) {
      await supabase.rpc('release_credits', { p_user_id: user.id, p_credits: credits, p_reference_id: reference });
      return Response.json({ error: 'Generation could not be started.' }, { status: 502 });
    }
  } catch (error) {
    console.error('generate route', error);
    return Response.json({ error: 'Generation could not be started.' }, { status: 500 });
  }
}
