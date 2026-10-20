// Step 1 of every scene: a still (the scene's first frame) the user approves
// before any video is paid for. Stills are cheap, so looks are fixed here
// instead of by re-rolling expensive video.
//   - Scenes with a real face: identity-preserving edit of the person's photo,
//     checked against the photo (retried once, refunded if it can't match).
//   - Other scenes: a photoreal text-to-image still.
// The job runs inside the request (stills take seconds) and settles at once.

import {
  callRpc,
  createSignedDownloadUrl,
  insertRows,
  requireSecret,
  safeError,
  selectOne,
  selectRows,
  updateRows,
} from '../cinexvideo-server.js';
import { archiveSoon } from '../storage/archive.js';
import { blockedMessage, moderate } from '../moderation/moderate.js';
import { handleModeration } from '../moderation/cases.js';
import { blockedPayload, suggestSafeAlternative } from '../moderation/alternative.js';
import { AT_COST_POLICY, atCostCredits } from '../billing/at-cost.js';
import { PLAN_PRICING_POLICY, planCodeFor, planCredits } from '../billing/plan-pricing.js';
import {
  FaceMismatchError,
  StillQualityError,
  KEYFRAME_MODEL,
  LIKENESS_BUCKET,
  STILL_MODEL,
  keyframeCents,
  makeKeyframe,
  makeStill,
  resolveSceneLikeness,
} from '../music/likeness.js';

const RULE_FIELDS = 'provider,model,provider_cost_cents,fixed_overhead_cents,variable_overhead_percent,payment_fee_fixed_cents,payment_fee_percent,minimum_customer_price_cents';
const RESOLUTIONS = new Set(['720p', '1080p']);

/** Price a still for this scene. Returns { model, rule, cost, credits, listCredits, planCode, likeness } or { error }. */
export async function quoteStill({ sceneId, resolution, userId, atCost }) {
  const likeness = await resolveSceneLikeness(sceneId);
  const model = likeness ? KEYFRAME_MODEL : STILL_MODEL;
  const rule = await selectOne('model_cost_rules', { model: `eq.${model}`, operation: 'eq.image', active: 'eq.true' }, RULE_FIELDS);
  if (!rule) return { error: safeError('Scene stills are temporarily unavailable.', 409) };
  const res = RESOLUTIONS.has(resolution) ? resolution : '720p';
  const cost = likeness ? keyframeCents(res) : Math.max(0, Number(rule.provider_cost_cents) || 0);
  const quote = await callRpc('quote_generation', {
    p_provider: rule.provider,
    p_model: model,
    p_operation: 'image',
    p_provider_cost_cents: cost,
    p_duration_seconds: 1,
    p_resolution: null,
    p_reference_count: 0,
  });
  const row = Array.isArray(quote.data) ? quote.data[0] : quote.data;
  if (!quote.ok || !row?.approved) return { error: safeError('Scene stills are temporarily unavailable.', 409) };
  const listCredits = Number(row.credits);
  const planCode = atCost ? null : await planCodeFor(userId);
  const credits = atCost
    ? atCostCredits(cost)
    : (planCode ? planCredits({ rule, providerCostCents: cost, listCredits, planCode }) : listCredits);
  return { model, rule, cost, credits, listCredits, planCode, likeness, resolution: res };
}

/** Make (and pay for) a still. Returns a Response. */
export async function runStillJob({ request, body, user, atCost, sceneId, projectId }) {
  if (!sceneId) return safeError('Choose a scene first.', 400);
  const scene = await selectOne('scenes', { id: `eq.${sceneId}` }, 'id,project_id,prompt,purpose,title,lip_sync,shot_direction');
  if (!scene) return safeError('Scene not found.', 404);
  const input = body.input && typeof body.input === 'object' ? body.input : {};
  const scenePrompt = String(input.prompt || scene.prompt || scene.purpose || scene.title || '').slice(0, 2400);
  if (!scenePrompt.trim()) return safeError('Describe this shot first.', 400);

  const q = await quoteStill({ sceneId, resolution: input.resolution ?? body.resolution, userId: user.id, atCost });
  if (q.error) return q.error;
  if (body.quote_only) {
    return Response.json({
      credits_required: q.credits,
      list_credits: q.listCredits,
      plan_code: q.planCode,
      operation: 'keyframe',
      real_face: Boolean(q.likeness),
      at_cost: atCost,
    });
  }
  if (!Number.isInteger(Number(body.confirmed_max_credits)) || Number(body.confirmed_max_credits) < q.credits) {
    return safeError('The price changed. Review the updated credit total before continuing.', 409);
  }
  const idempotencyKey = request.headers.get('idempotency-key');
  if (!idempotencyKey) return safeError('An idempotency key is required.', 400);

  // Content check before anything is charged: the description and, for real
  // faces, the person's photo.
  const modDeps = { insertRows, updateRows };
  const caseInfo = { userId: user.id, projectId: projectId || scene.project_id, sceneId, prompt: scenePrompt };
  const photoUrl = q.likeness?.asset?.storage_path ? await createSignedDownloadUrl(LIKENESS_BUCKET, q.likeness.asset.storage_path, 600) : null;
  const pre = await moderate({ text: scenePrompt, imageUrls: photoUrl ? [photoUrl] : [] });
  await handleModeration(pre, { ...caseInfo, kind: photoUrl ? 'photo' : 'prompt', where: 'still_request', mediaUrl: null }, modDeps);
  if (!pre.allowed) {
    // Was it the photo or the words? (Text-only checks are free.)
    const photoOnly = photoUrl && (await moderate({ text: scenePrompt })).allowed;
    if (photoOnly) {
      return Response.json(blockedPayload({
        message: "This person's face photo can't be used because it looks like " + pre.labels.join(', ') + '. Nothing was charged. Choose a different photo of them (head and shoulders, fully clothed) in Faces, then make the still again.',
        decision: pre, target: 'photo', sceneId,
      }), { status: 422 });
    }
    const description = String(scene.prompt || scenePrompt);
    const alternative = await suggestSafeAlternative({ text: description, decision: pre, userId: user.id });
    return Response.json(blockedPayload({ message: blockedMessage(pre), decision: pre, alternative, sceneId }), { status: 422 });
  }

  const reserved = await callRpc(atCost ? 'reserve_paid_credits_v1' : 'reserve_credits_v2', {
    p_user_id: user.id,
    p_operation: 'keyframe',
    p_estimated_credits: q.credits,
    p_max_reservation_credits: q.credits,
    p_pricing_policy_version: atCost ? AT_COST_POLICY : q.planCode ? PLAN_PRICING_POLICY : '2026-09-06-v1',
    p_idempotency_key: `still:${idempotencyKey}`,
  });
  const reservation = Array.isArray(reserved.data) ? reserved.data[0] : reserved.data;
  if (!reserved.ok || !reservation?.id) {
    const message = String(reserved.data?.message || '');
    if (message.includes('INSUFFICIENT')) return safeError('You need more credits to continue.', 402);
    return safeError('Could not reserve credits. Please try again.', 409);
  }
  if (reservation.status && reservation.status !== 'reserved') {
    return safeError('This still was already made. Refresh to see it.', 409);
  }

  const job = await insertRows('generation_requests', {
    user_id: user.id,
    project_id: projectId || scene.project_id,
    scene_id: sceneId,
    provider: q.rule.provider,
    model: q.model,
    operation: 'image',
    reservation_reference: reservation.id,
    credits_reserved: q.credits,
    provider_cost_cents: Math.ceil(q.cost),
    funding_source: 'credits',
    idempotency_key: `still:${idempotencyKey}`,
    status: 'running',
  });
  const jobId = job.data?.[0]?.id || null;
  const release = async (reason) => {
    await callRpc('release_reservation_v2', { p_reservation_id: reservation.id, p_reason: reason });
    if (jobId) await updateRows('generation_requests', { id: `eq.${jobId}` }, { status: 'released', error_note: reason });
  };
  if (!jobId) { await release('job_record_failed'); return safeError('The still could not be started. You were not charged.', 500); }

  let url;
  try {
    const apiKey = requireSecret('MUAPI_API_KEY');
    const base = process.env.MUAPI_BASE_URL || 'https://api.muapi.ai';
    url = q.likeness
      ? await makeKeyframe({ base, apiKey, asset: q.likeness.asset, scenePrompt, aspectRatio: input.aspect_ratio, resolution: q.resolution, singing: Boolean(scene.lip_sync), shotDirection: scene.shot_direction })
      : await makeStill({ base, apiKey, scenePrompt, aspectRatio: input.aspect_ratio });
  } catch (error) {
    console.error('still job failed', error?.message);
    await release(error instanceof FaceMismatchError ? 'face_mismatch' : error instanceof StillQualityError ? 'text_quality' : 'provider_failed');
    if (error instanceof StillQualityError) {
      return safeError('The writing on signs in this shot kept coming out as gibberish, so nothing was kept and your credits were returned. Try again, or set real words under Visual Direction → Words on signs.', 422);
    }
    if (error instanceof FaceMismatchError) {
      return safeError(`We couldn't keep ${q.likeness?.asset?.name || 'this person'}'s face accurate in this shot, so nothing was made and your credits were returned. Try a sharper, front-facing photo or a simpler scene description.`, 422);
    }
    return safeError('The still could not be made right now. You were not charged.', 502);
  }

  // The finished still is checked before the user ever sees it. If it is
  // blocked it is withheld (kept only in quarantine for review) and refunded.
  const post = await moderate({ imageUrls: [url] });
  await handleModeration(post, { ...caseInfo, kind: 'still', where: 'still_output', mediaUrl: url }, modDeps);
  if (!post.allowed) {
    await release('moderation_blocked');
    const alternative = await suggestSafeAlternative({ text: String(scene.prompt || scenePrompt), decision: post, stage: 'result', userId: user.id });
    return Response.json(blockedPayload({
      message: `The still came out looking like ${post.labels.join(', ')}, so we withheld it and returned your credits. ${alternative ? 'Here is a safer version of the scene to try instead.' : 'Please change the description and try again.'}`,
      decision: post, alternative, stage: 'result', sceneId,
    }), { status: 422 });
  }

  const saved = await updateRows('scenes', { id: `eq.${sceneId}` }, {
    keyframe_url: url,
    keyframe_approved: false,
    keyframe_at: new Date().toISOString(),
  });
  if (!saved.ok) { await release('save_failed'); return safeError('The still could not be saved. You were not charged.', 500); }
  // Copy the still into our own storage before the provider's link expires.
  archiveSoon('still', { id: sceneId, keyframe_url: url }, { selectOne, selectRows, insertRows, updateRows });
  const settled = await callRpc('settle_reservation_v2', { p_reservation_id: reservation.id, p_settled_credits: q.credits, p_generation_job_id: jobId });
  if (!settled.ok) console.error('still settle failed', reservation.id);
  await updateRows('generation_requests', { id: `eq.${jobId}` }, { status: 'completed', output: { url } });
  await callRpc('settle_generation_revenue', { p_generation_request_id: jobId });
  await insertRows('admin_metric_events', {
    event_type: 'generation_completed', operation: 'image', model: q.model, user_id: user.id, credits: q.credits, status: 'completed',
  });
  return Response.json({ status: 'completed', keyframe_url: url, credits_charged: q.credits });
}
