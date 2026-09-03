import { getBearerUser, requireSecret, safeError } from '../../../../lib/cinexvideo-server';

export async function GET(request, { params }) {
  const user = await getBearerUser(request);
  if (!user) return safeError('Authentication required.', 401);
  try {
    const apiKey = requireSecret('MUAPI_API_KEY');
    const base = process.env.MUAPI_BASE_URL || 'https://api.muapi.ai';
    const response = await fetch(`${base}/api/v1/predictions/${encodeURIComponent(params.requestId)}/result`, { headers: { Authorization: `Bearer ${apiKey}` }, cache: 'no-store' });
    const data = await response.json();
    return Response.json({ status: data.status || data.state || 'unknown', output: data.output || data.result || null });
  } catch (error) {
    console.error('job route', error);
    return safeError('Generation status is temporarily unavailable.', 502);
  }
}
