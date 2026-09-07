import { guard, requireSecret, safeError } from '../../../lib/cinexvideo-server';
import {
  DIRECTOR_ACTION_BRIEFS,
  DIRECTOR_FIELD_BRIEFS,
  isDirectorAction,
} from '../../../lib/director-actions';

const DIRECTOR_MODEL = process.env.OPENAI_DIRECTOR_MODEL || 'gpt-5';

const ASSIST_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    suggestion: { type: 'string' },
    whatChanged: { type: 'string' },
    craftNote: { type: 'string' },
    followUpPrompts: { type: 'array', items: { type: 'string' } },
  },
  required: ['suggestion', 'whatChanged', 'craftNote', 'followUpPrompts'],
};

async function callDirectorModel({ system, user, schemaName, schema }) {
  const apiKey = requireSecret('OPENAI_API_KEY');
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: DIRECTOR_MODEL,
      input: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      text: { format: { type: 'json_schema', name: schemaName, strict: true, schema } },
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    console.error('director model call failed', response.status, detail.slice(0, 500));
    return null;
  }
  const result = await response.json();
  const text =
    result.output_text ||
    result.output?.flatMap((item) => item.content || []).find((item) => item.type === 'output_text')?.text;
  if (!text) return null;
  return JSON.parse(text);
}

/**
 * Writing assistance for a single field.
 *
 * The Director panel previously disabled every button outside local demo mode,
 * so signed-in customers had no working assistant at all. This path gives the
 * panel a real server-side Director. It uses no credits: writing help is free.
 */
async function handleAssist(body) {
  const { action, field_type: fieldType, value, instruction = '', context = {} } = body;

  if (!isDirectorAction(action)) return safeError('That Director action is not available.', 400);
  if (!String(value || '').trim()) return safeError('Add some text before asking the Director.', 400);
  if (action === 'applyDirectorInstruction' && !String(instruction).trim()) {
    return safeError('Tell the Director what you need.', 400);
  }

  const fieldBrief = DIRECTOR_FIELD_BRIEFS[fieldType] || DIRECTOR_FIELD_BRIEFS.scene;
  const system = [
    'You are CinexVideo AI Director, an elite film, series and music-video director helping a writer improve their own work.',
    fieldBrief,
    `Task: ${DIRECTOR_ACTION_BRIEFS[action]}`,
    'Return only the rewritten or newly drafted text in `suggestion`, ready to drop straight into the field — no preamble, headings or quotes.',
    'Explain the edit in `whatChanged`, give one short teaching point in `craftNote`, and offer one or two follow-up questions.',
    'Never mention vendors, models, APIs, credits, costs or internal business rules.',
  ].join(' ');

  const details = [
    `Current text:\n${String(value).slice(0, 4000)}`,
    context.style ? `Visual style: ${context.style}` : null,
    context.genre ? `Genre: ${context.genre}` : null,
    context.sceneContext ? `Scene context: ${String(context.sceneContext).slice(0, 1000)}` : null,
    context.duration ? `Target duration: ${context.duration} seconds` : null,
    instruction ? `Writer's instruction: ${String(instruction).slice(0, 1000)}` : null,
  ]
    .filter(Boolean)
    .join('\n\n');

  const plan = await callDirectorModel({
    system,
    user: details,
    schemaName: 'cinexvideo_director_assist',
    schema: ASSIST_SCHEMA,
  });
  if (!plan) return safeError('Director service is temporarily unavailable.', 502);

  return Response.json({
    suggestion: plan.suggestion,
    whatChanged: plan.whatChanged,
    craftNote: plan.craftNote,
    followUpPrompts: Array.isArray(plan.followUpPrompts) ? plan.followUpPrompts.slice(0, 3) : [],
  });
}

const LANE_BRIEF = {
  music_video:
    'You are planning a music video: prioritise performance beats, rhythm-led cutting and a strong visual hook.',
  episode:
    'You are planning an episode of a series: prioritise story structure, character arc and scene-to-scene continuity.',
};

export async function POST(request) {
  const { error } = await guard(request, { blockOnMaintenance: true });
  if (error) return error;
  try {
    const body = await request.json();
    if (body.action) return await handleAssist(body);
    if (!body.prompt?.trim()) return safeError('Please enter a creative idea.');
    const laneBrief = LANE_BRIEF[body.lane] || LANE_BRIEF.episode;
    const apiKey = requireSecret('OPENAI_API_KEY');
    const response = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model: process.env.OPENAI_DIRECTOR_MODEL || 'gpt-5', input: [{ role: 'system', content: `You are CinexVideo AI Director, an original elite film, series, and music-video director. ${laneBrief} Return concise production-ready direction as JSON with creative_title, logline, visual_identity, characters, locations, outfits, and scenes. Plan between 4 and 12 scenes. Do not mention vendors, APIs, costs, or internal business rules.` }, { role: 'user', content: body.prompt }], text: { format: { type: 'json_schema', name: 'cinexvideo_director_plan', strict: true, schema: { type: 'object', additionalProperties: false, properties: { creative_title: { type: 'string' }, logline: { type: 'string' }, visual_identity: { type: 'object', additionalProperties: false, properties: { palette: { type: 'array', items: { type: 'string' } }, lighting: { type: 'string' }, camera_language: { type: 'string' } }, required: ['palette','lighting','camera_language'] }, characters: { type: 'array', items: { type: 'string' } }, locations: { type: 'array', items: { type: 'string' } }, outfits: { type: 'array', items: { type: 'string' } }, scenes: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { title: { type: 'string' }, purpose: { type: 'string' }, duration_seconds: { type: 'integer' }, shot_direction: { type: 'string' }, prompt: { type: 'string' } }, required: ['title','purpose','duration_seconds','shot_direction','prompt'] } } }, required: ['creative_title','logline','visual_identity','characters','locations','outfits','scenes'] } } } }) });
    if (!response.ok) return safeError('Director service is temporarily unavailable.', 502);
    const result = await response.json();
    const text = result.output_text || result.output?.flatMap((item) => item.content || []).find((item) => item.type === 'output_text')?.text;
    return Response.json({ plan: JSON.parse(text) });
  } catch (error) {
    console.error('director route', error);
    return safeError('Director service is temporarily unavailable.', 500);
  }
}
