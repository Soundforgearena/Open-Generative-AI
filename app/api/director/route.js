import { callRpc, guard, requireSecret, safeError } from '../../../lib/cinexvideo-server';
import { DIRECTOR_MAX_OUTPUT_TOKENS, DIRECTOR_PRICING_POLICY, directorCost } from '../../../lib/billing/director-pricing';
import {
  DIRECTOR_ACTION_BRIEFS,
  DIRECTOR_FIELD_BRIEFS,
  DIRECTOR_PERSONA,
  actionRequiresExistingText,
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

async function callDirectorModel({ system, user, schemaName, schema, maxOutputTokens }) {
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
      max_output_tokens: maxOutputTokens,
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

/** Checks run before any credits are reserved, so bad requests are never charged. */
function validateAssist(body) {
  const { action, value, instruction = '' } = body;
  if (!isDirectorAction(action)) return safeError('That Director action is not available.', 400);

  const currentText = String(value || '').trim();
  // An empty field is a valid starting point: the Director drafts it from the
  // project context. Only the actions that genuinely operate on existing prose
  // (tightening, pacing, dialogue) still need something to work with.
  if (!currentText && actionRequiresExistingText(action)) {
    return safeError('Add some text first, or ask the Director to draft this field for you.', 400);
  }
  if (action === 'applyDirectorInstruction' && !String(instruction).trim()) {
    return safeError('Tell the Director what you need.', 400);
  }

  return null;
}

/**
 * Writing assistance for a single field.
 *
 * The Director panel previously disabled every button outside local demo mode,
 * so signed-in customers had no working assistant at all. This path gives the
 * panel a real server-side Director. Every call is charged in credits: the
 * route reserves them before the model runs, settles on success and releases
 * them automatically if the Director fails.
 */
async function handleAssist(body) {
  const { action, field_type: fieldType, value, instruction = '', context = {} } = body;
  const currentText = String(value || '').trim();
  const fieldBrief = DIRECTOR_FIELD_BRIEFS[fieldType] || DIRECTOR_FIELD_BRIEFS.scene;
  const system = [
    DIRECTOR_PERSONA,
    fieldBrief,
    `Task: ${DIRECTOR_ACTION_BRIEFS[action]}`,
    'Return only the rewritten or newly drafted text in `suggestion`, ready to drop straight into the field — no preamble, headings or quotes.',
    'Explain the edit in `whatChanged`, give one short teaching point in `craftNote`, and offer one or two follow-up questions.',
    'Never mention vendors, models, APIs, credits, costs or internal business rules.',
  ].join(' ');

  const details = [
    currentText
      ? `Current text:\n${currentText.slice(0, 4000)}`
      : 'The field is currently empty. Write the first draft from the project context below.',
    context.projectTitle ? `Project title: ${String(context.projectTitle).slice(0, 200)}` : null,
    context.logline ? `Project logline: ${String(context.logline).slice(0, 600)}` : null,
    context.fieldLabel ? `Field being written: ${String(context.fieldLabel).slice(0, 100)}` : null,
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
    maxOutputTokens: DIRECTOR_MAX_OUTPUT_TOKENS.assist,
  });
  if (!plan) return safeError('Director service is temporarily unavailable.', 502);

  return Response.json({
    suggestion: plan.suggestion,
    whatChanged: plan.whatChanged,
    craftNote: plan.craftNote,
    followUpPrompts: Array.isArray(plan.followUpPrompts) ? plan.followUpPrompts.slice(0, 3) : [],
  });
}

const PLAN_SCHEMA = { type: 'object', additionalProperties: false, properties: { creative_title: { type: 'string' }, logline: { type: 'string' }, visual_identity: { type: 'object', additionalProperties: false, properties: { palette: { type: 'array', items: { type: 'string' } }, lighting: { type: 'string' }, camera_language: { type: 'string' } }, required: ['palette','lighting','camera_language'] }, characters: { type: 'array', items: { type: 'string' } }, locations: { type: 'array', items: { type: 'string' } }, outfits: { type: 'array', items: { type: 'string' } }, scenes: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { title: { type: 'string' }, purpose: { type: 'string' }, duration_seconds: { type: 'integer' }, shot_direction: { type: 'string' }, prompt: { type: 'string' } }, required: ['title','purpose','duration_seconds','shot_direction','prompt'] } } }, required: ['creative_title','logline','visual_identity','characters','locations','outfits','scenes'] };

const LANE_BRIEF = {
  music_video:
    'You are planning a music video: prioritise performance beats, rhythm-led cutting and a strong visual hook.',
  episode:
    'You are planning an episode of a series: prioritise story structure, character arc and scene-to-scene continuity.',
};

function errorMessage(result) {
  return String(result?.data?.message || result?.data?.error || '');
}

/**
 * Reserve the Director's price up front so a user can never run the model
 * without the credits to pay for it. Success settles the charge; any failure
 * (model error, timeout, bad output) releases it in full.
 */
async function chargeDirector(user, kind, idempotencyKey, run) {
  const credits = directorCost(kind);
  const reservation = await callRpc('reserve_credits_v2', {
    p_user_id: user.id,
    p_operation: `director_${kind}`,
    p_estimated_credits: credits,
    p_max_reservation_credits: credits,
    p_pricing_policy_version: DIRECTOR_PRICING_POLICY,
    p_idempotency_key: idempotencyKey,
  });
  const row = Array.isArray(reservation.data) ? reservation.data[0] : reservation.data;
  if (!reservation.ok || !row?.id) {
    const message = errorMessage(reservation);
    if (message.includes('INSUFFICIENT_CREDITS')) {
      return Response.json(
        { error: `The AI Director costs ${credits} credits. Add credits to keep directing.`, code: 'insufficient_credits', credits_required: credits },
        { status: 402 }
      );
    }
    if (message.includes('IDEMPOTENCY_KEY_CONFLICT')) return safeError('This Director request was already used. Please try again.', 409);
    if (message.includes('No credit wallet')) return safeError('Your credit wallet is not ready yet. Please refresh and try again.', 409);
    return safeError('Could not reserve credits for the Director. Please try again.', 409);
  }
  if (row.status !== 'reserved') return safeError('This Director request was already processed.', 409);

  let response;
  try {
    response = await run();
  } catch (err) {
    console.error('director run failed', err);
    response = safeError('Director service is temporarily unavailable.', 502);
  }
  if (response.ok) {
    const settled = await callRpc('settle_reservation_v2', { p_reservation_id: row.id, p_settled_credits: credits, p_generation_job_id: null });
    if (!settled.ok) console.error('director settle failed', row.id, errorMessage(settled));
    const data = await response.json();
    return Response.json({ ...data, credits_charged: credits });
  }
  const released = await callRpc('release_reservation_v2', { p_reservation_id: row.id, p_reason: 'director_failed' });
  if (!released.ok) console.error('director release failed', row.id, errorMessage(released));
  return response;
}

export async function POST(request) {
  const { user, error } = await guard(request, { blockOnMaintenance: true });
  if (error) return error;
  try {
    const body = await request.json();
    const idempotencyKey = request.headers.get('idempotency-key') || crypto.randomUUID();
    if (body.action) {
      const invalid = validateAssist(body);
      if (invalid) return invalid;
      return await chargeDirector(user, 'assist', idempotencyKey, () => handleAssist(body));
    }
    if (!body.prompt?.trim()) return safeError('Please enter a creative idea.');
    const laneBrief = LANE_BRIEF[body.lane] || LANE_BRIEF.episode;
    return await chargeDirector(user, 'plan', idempotencyKey, async () => {
      const plan = await callDirectorModel({
        system: `${DIRECTOR_PERSONA} ${laneBrief} Return concise production-ready direction as JSON with creative_title, logline, visual_identity, characters, locations, outfits, and scenes. Plan between 4 and 12 scenes. Do not mention vendors, APIs, costs, or internal business rules.`,
        user: body.prompt.slice(0, 6000),
        schemaName: 'cinexvideo_director_plan',
        schema: PLAN_SCHEMA,
        maxOutputTokens: DIRECTOR_MAX_OUTPUT_TOKENS.plan,
      });
      if (!plan) return safeError('Director service is temporarily unavailable.', 502);
      return Response.json({ plan });
    });
  } catch (error) {
    console.error('director route', error);
    return safeError('Director service is temporarily unavailable.', 500);
  }
}
