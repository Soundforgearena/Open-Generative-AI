import { getBearerUser, getAdminSupabase, isMaintenanceEnabled, requireSecret, safeError } from '../../../lib/cinexvideo-server';

export async function POST(request) {
  try {
    if (await isMaintenanceEnabled()) return Response.json({ error: 'Creative services are temporarily unavailable.' }, { status: 503 });
    const user = await getBearerUser(request);
    if (!user) return Response.json({ error: 'Authentication required.' }, { status: 401 });
    const body = await request.json();
    if (!body.prompt?.trim()) return safeError('Please enter a creative idea.');
    const apiKey = requireSecret('OPENAI_API_KEY');
    const response = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model: process.env.OPENAI_DIRECTOR_MODEL || 'gpt-5', input: [{ role: 'system', content: 'You are CinexVideo AI Director, an original elite film, series, and music-video director. Return concise production-ready direction as JSON with creative_title, logline, visual_identity, characters, locations, outfits, and scenes. Do not mention vendors, APIs, costs, or internal business rules.' }, { role: 'user', content: body.prompt }], text: { format: { type: 'json_schema', name: 'cinexvideo_director_plan', strict: true, schema: { type: 'object', additionalProperties: false, properties: { creative_title: { type: 'string' }, logline: { type: 'string' }, visual_identity: { type: 'object', additionalProperties: false, properties: { palette: { type: 'array', items: { type: 'string' } }, lighting: { type: 'string' }, camera_language: { type: 'string' } }, required: ['palette','lighting','camera_language'] }, characters: { type: 'array', items: { type: 'string' } }, locations: { type: 'array', items: { type: 'string' } }, outfits: { type: 'array', items: { type: 'string' } }, scenes: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { title: { type: 'string' }, purpose: { type: 'string' }, duration_seconds: { type: 'integer' }, shot_direction: { type: 'string' }, prompt: { type: 'string' } }, required: ['title','purpose','duration_seconds','shot_direction','prompt'] } } }, required: ['creative_title','logline','visual_identity','characters','locations','outfits','scenes'] } } } }) });
    if (!response.ok) return Response.json({ error: 'Director service is temporarily unavailable.' }, { status: 502 });
    const result = await response.json();
    const text = result.output_text || result.output?.flatMap((item) => item.content || []).find((item) => item.type === 'output_text')?.text;
    return Response.json({ plan: JSON.parse(text) });
  } catch (error) {
    console.error('director route', error);
    return Response.json({ error: 'Director service is temporarily unavailable.' }, { status: 500 });
  }
}
