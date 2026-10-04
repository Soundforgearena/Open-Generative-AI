import { callRpc, guard, requireSecret, safeError } from '../../../lib/cinexvideo-server';
import { AT_COST_POLICY, isAtCostUser } from '../../../lib/billing/at-cost';
import {
  CHARS_PER_TOKEN,
  DIRECTOR_PRICING_POLICY,
  DIRECTOR_TOKEN_BUDGET,
  isReasoningModel,
  maxDirectorCredits,
  ratesFor,
  settledDirectorCredits,
  typicalDirectorCredits,
} from '../../../lib/billing/director-pricing';
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

/** Keep every request inside its priced input budget. */
function fitInput(text, kind) {
  const maxChars = Math.floor(DIRECTOR_TOKEN_BUDGET[kind].input * CHARS_PER_TOKEN);
  return String(text || '').slice(0, maxChars);
}

async function callDirectorModel({ kind, system, user, schemaName, schema }) {
  const apiKey = requireSecret('OPENAI_API_KEY');
  const budget = DIRECTOR_TOKEN_BUDGET[kind];
  const systemText = fitInput(system, kind);
  const userText = fitInput(user, kind).slice(0, Math.max(0, Math.floor(budget.input * CHARS_PER_TOKEN) - systemText.length));
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: DIRECTOR_MODEL,
      input: [
        { role: 'system', content: systemText },
        { role: 'user', content: userText },
      ],
      max_output_tokens: budget.output,
      ...(isReasoningModel(DIRECTOR_MODEL) ? { reasoning: { effort: 'low' } } : {}),
      text: { format: { type: 'json_schema', name: schemaName, strict: true, schema } },
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    console.error('director model call failed', response.status, detail.slice(0, 500));
    return null;
  }
  const result = await response.json();
  if (result.status && result.status !== 'completed') {
    console.error('director model incomplete', result.status, result.incomplete_details);
    return null;
  }
  const text =
    result.output_text ||
    result.output?.flatMap((item) => item.content || []).find((item) => item.type === 'output_text')?.text;
  if (!text) return null;
  return { data: JSON.parse(text), usage: result.usage || null };
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

  const model = await callDirectorModel({
    kind: 'assist',
    system,
    user: details,
    schemaName: 'cinexvideo_director_assist',
    schema: ASSIST_SCHEMA,
  });
  if (!model) return { response: safeError('Director service is temporarily unavailable.', 502) };
  const plan = model.data;

  return {
    usage: model.usage,
    response: Response.json({
      suggestion: plan.suggestion,
      whatChanged: plan.whatChanged,
      craftNote: plan.craftNote,
      followUpPrompts: Array.isArray(plan.followUpPrompts) ? plan.followUpPrompts.slice(0, 3) : [],
    }),
  };
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
 * Reserve the Director's maximum price in purchased credits before the model
 * runs (sign-up and bonus credits cannot be used). On success, settle at the
 * cost of the tokens actually used plus margin; any failure releases it all.
 */
async function chargeDirector(user, kind, idempotencyKey, run, { atCost = false } = {}) {
  const pricing = { atCost };
  const maxCredits = maxDirectorCredits(kind, DIRECTOR_MODEL, pricing);
  if (!ratesFor(DIRECTOR_MODEL).known) console.warn('director model has no rate card; using conservative pricing', DIRECTOR_MODEL);
  const reservation = await callRpc('reserve_paid_credits_v1', {
    p_user_id: user.id,
    p_operation: `director_${kind}`,
    p_estimated_credits: Math.min(maxCredits, typicalDirectorCredits(kind, DIRECTOR_MODEL, pricing)),
    p_max_reservation_credits: maxCredits,
    p_pricing_policy_version: atCost ? AT_COST_POLICY : DIRECTOR_PRICING_POLICY,
    p_idempotency_key: idempotencyKey,
  });
  const row = Array.isArray(reservation.data) ? reservation.data[0] : reservation.data;
  if (!reservation.ok || !row?.id) {
    const message = errorMessage(reservation);
    if (message.includes('INSUFFICIENT_PAID_CREDITS') || message.includes('INSUFFICIENT_CREDITS')) {
      return Response.json(
        {
          error: `The AI Director runs on purchased credits. This request can cost up to ${maxCredits} credits ($${(maxCredits / 100).toFixed(2)}); sign-up bonus credits can't be used for it.`,
          code: 'insufficient_paid_credits',
          credits_required: maxCredits,
        },
        { status: 402 }
      );
    }
    if (message.includes('IDEMPOTENCY_KEY_CONFLICT')) return safeError('This Director request was already used. Please try again.', 409);
    if (message.includes('No credit wallet')) return safeError('Your credit wallet is not ready yet. Please refresh and try again.', 409);
    return safeError('Could not reserve credits for the Director. Please try again.', 409);
  }

  let outcome;
  try {
    outcome = await run();
  } catch (err) {
    console.error('director run failed', err);
    outcome = { response: safeError('Director service is temporarily unavailable.', 502) };
  }
  if (outcome.response.ok) {
    const charged = settledDirectorCredits(kind, DIRECTOR_MODEL, outcome.usage, pricing);
    const settled = await callRpc('settle_reservation_v2', { p_reservation_id: row.id, p_settled_credits: charged, p_generation_job_id: null });
    if (!settled.ok) console.error('director settle failed', row.id, errorMessage(settled));
    const data = await outcome.response.json();
    return Response.json({ ...data, credits_charged: charged, credits_max: maxCredits, at_cost: atCost });
  }
  const released = await callRpc('release_reservation_v2', { p_reservation_id: row.id, p_reason: 'director_failed' });
  if (!released.ok) console.error('director release failed', row.id, errorMessage(released));
  return outcome.response;
}

/** Public price list for the Director, in credits (1 credit = $0.01). */
export async function GET(request) {
  let paidAvailable = null;
  let atCost = false;
  if (request.headers.get('authorization')) {
    const { user, superAdmin } = await guard(request);
    atCost = isAtCostUser({ superAdmin });
    if (user) {
      const paid = await callRpc('paid_credits_available', { p_user_id: user.id });
      if (paid.ok) paidAvailable = Number(Array.isArray(paid.data) ? paid.data[0] : paid.data) || 0;
    }
  }
  const price = (kind) => ({ max_credits: maxDirectorCredits(kind, DIRECTOR_MODEL, { atCost }), typical_credits: typicalDirectorCredits(kind, DIRECTOR_MODEL, { atCost }) });
  return Response.json({
    credit_usd_cents: 1,
    paid_credits_only: true,
    assist: price('assist'),
    plan: price('plan'),
    paid_credits_available: paidAvailable,
    at_cost: atCost,
    policy: DIRECTOR_PRICING_POLICY,
  });
}

export async function POST(request) {
  const { user, superAdmin, error } = await guard(request, { blockOnMaintenance: true });
  if (error) return error;
  // Super admins pay cost (no margin); everyone else pays the marked-up price.
  // Both are paid with purchased credits only.
  const atCost = isAtCostUser({ superAdmin });
  const charge = (kind, key, run) => chargeDirector(user, kind, key, run, { atCost });
  try {
    const body = await request.json();
    const idempotencyKey = request.headers.get('idempotency-key') || crypto.randomUUID();
    if (body.action) {
      const invalid = validateAssist(body);
      if (invalid) return invalid;
      return await charge('assist', idempotencyKey, () => handleAssist(body));
    }
    if (!body.prompt?.trim()) return safeError('Please enter a creative idea.');
    const laneBrief = LANE_BRIEF[body.lane] || LANE_BRIEF.episode;
    return await charge('plan', idempotencyKey, async () => {
      const model = await callDirectorModel({
        kind: 'plan',
        system: `${DIRECTOR_PERSONA} ${laneBrief} Return concise production-ready direction as JSON with creative_title, logline, visual_identity, characters, locations, outfits, and scenes. Plan between 4 and 12 scenes. Do not mention vendors, APIs, costs, or internal business rules.`,
        user: body.prompt.slice(0, 6000),
        schemaName: 'cinexvideo_director_plan',
        schema: PLAN_SCHEMA,
      });
      if (!model) return { response: safeError('Director service is temporarily unavailable.', 502) };
      return { usage: model.usage, response: Response.json({ plan: model.data }) };
    });
  } catch (error) {
    console.error('director route', error);
    return safeError('Director service is temporarily unavailable.', 500);
  }
}
