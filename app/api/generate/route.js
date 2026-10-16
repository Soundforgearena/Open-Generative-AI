import {
  guard,
  callRpc,
  selectOne,
  selectRows,
  insertRows,
  updateRows,
  requireSecret,
  safeError,
} from '../../../lib/cinexvideo-server';
import { AT_COST_POLICY, atCostCredits, isAtCostUser } from '../../../lib/billing/at-cost.js';
import { providerCostCents } from '../../../lib/billing/provider-pricing.js';
import { evaluateProviderExposure } from '../../../lib/billing/provider-exposure-guard.js';
import { evaluateReservationRisk } from '../../../lib/billing/risk-policy.js';
import { loadRuntimeSafetySignals } from '../../../lib/billing/runtime-safety-signals.js';
import { buildPreflightReport } from '../../../lib/billing/generation-preflight.js';
import { normalizeMuapiCost } from '../../../lib/providers/muapi-cost-adapter.js';
import { rateLimit } from '../../../lib/rate-limit';
import { projectSong, sliceSongForScene } from '../../../lib/music/audio.js';
import { FaceMismatchError, LIKENESS_VIDEO_MODEL, PERFORM_AUDIO_MIN_MS, PERFORM_MAX_MS, PERFORM_MIN_MS, PERFORM_MODEL, keyframeCents, likenessMotionPrompt, makeKeyframe, performPrompt, resolveSceneLikeness } from '../../../lib/music/likeness.js';
import { PLAN_PRICING_POLICY, planCodeFor, planCredits } from '../../../lib/billing/plan-pricing.js';
import { runStillJob } from '../../../lib/generation/still-job.js';
import { retryState } from '../../../lib/generation/busy-retry.js';
import { BEAT_DANCE_MODEL, beatAspect, beatDanceFor, beatDancePrompt } from '../../../lib/music/beat-dance.js';
import { sliceForBeatDance } from '../../../lib/music/beat-slice.js';
import { parseShotDirection } from '../../../lib/studio/studio-model.js';
import { MOTION_MAX_MS, MOTION_MIN_MS, MOTION_MODEL, motionPrompt, sceneMotion, trimMotionClip } from '../../../lib/music/motion.js';

const SAFE_PROVIDER_FIELDS = new Set([
  'prompt',
  'negative_prompt',
  'aspect_ratio',
  'seed',
  'duration',
  'duration_seconds',
  'resolution',
  'images_list',
  'image_urls',
  'reference_images',
  'images',
  'references',
  'image_url',
  'start_image_url',
  'first_image_url',
  'last_image',
  'last_image_url',
  'end_image_url',
  'videos_list',
  'video_files',
  'video_urls',
  'reference_videos',
  'video_url',
  'audios_list',
  'audio_files',
  'audio_urls',
  'reference_audios',
  'audio_url',
]);

const REFERENCE_FIELDS = [
  'images_list',
  'image_urls',
  'reference_images',
  'images',
  'references',
  'image_url',
  'start_image_url',
  'first_image_url',
  'last_image',
  'last_image_url',
  'end_image_url',
  'videos_list',
  'video_files',
  'video_urls',
  'reference_videos',
  'video_url',
  'audios_list',
  'audio_files',
  'audio_urls',
  'reference_audios',
  'audio_url',
];

const PROVIDER_MODEL_ALIASES = Object.freeze({
  'pixverse-v6': 'pixverse-v6-t2v',
});

function providerEndpointFor(model) {
  return PROVIDER_MODEL_ALIASES[model] || model;
}

function referenceCountFor(input) {
  let count = 0;
  for (const field of REFERENCE_FIELDS) {
    const value = input[field];
    const values = Array.isArray(value) ? value : value ? [value] : [];
    for (const item of values) {
      if (typeof item !== 'string' || !item.trim()) {
        throw new Error('INVALID_REFERENCE');
      }
      count += 1;
    }
  }
  return count;
}

/**
 * Start a generation.
 *
 * Security note: the provider cost is looked up server-side from
 * model_cost_rules. It is never accepted from the request body — otherwise a
 * customer could post a cost of zero and drive the price below the internal
 * margin floor. The response exposes only the credit figure.
 */
export async function POST(request) {
  const { user, admin, superAdmin, error } = await guard(request, { blockOnMaintenance: true });
  // Super admins pay cost (provider + card fees, no margin) from purchased
  // credits; everyone else pays the marked-up quote.
  const atCost = isAtCostUser({ superAdmin });
  if (error) return error;
  const limited = rateLimit(`generate:${user.id}`, { limit: 120, windowMs: 60_000 });
  if (limited) return limited;

  try {
    const body = await request.json();
    let { model } = body;
    const {
      scene_id: sceneId = null,
      project_id: projectId = null,
      operation = 'video',
      duration_seconds: requestedDuration = 1,
      resolution: requestedResolution = null,
      quote_only: quoteOnly = false,
      preflight = false,
      confirmed_max_credits: confirmedMaxCredits = null,
      source_version_id: sourceVersionId = null,
    } = body;
    let { input } = body;

    if (!model || !input || typeof input !== 'object' || Array.isArray(input)) {
      return safeError('Generation settings are incomplete.');
    }
    const unsupportedFields = Object.keys(input).filter((field) => !SAFE_PROVIDER_FIELDS.has(field));
    if (unsupportedFields.length) {
      return safeError(`Unsupported generation setting: ${unsupportedFields[0]}.`, 400);
    }

    let ownedProject = null;
    if (projectId) {
      ownedProject = await selectOne('projects', { id: `eq.${projectId}` }, 'id,owner_id');
      if (!ownedProject || (ownedProject.owner_id !== user.id && !admin)) {
        return safeError('Project not found.', 404);
      }
    }
    if (sceneId) {
      const ownedScene = await selectOne('scenes', { id: `eq.${sceneId}` }, 'id,project_id,active_version');
      if (!ownedScene) return safeError('Scene not found.', 404);
      const sceneProject = ownedProject?.id === ownedScene.project_id
        ? ownedProject
        : await selectOne('projects', { id: `eq.${ownedScene.project_id}` }, 'id,owner_id');
      if (!sceneProject || (sceneProject.owner_id !== user.id && !admin)) {
        return safeError('Scene not found.', 404);
      }
      if (projectId && ownedScene.project_id !== projectId) {
        return safeError('Scene does not belong to this project.', 400);
      }
    }

    // Step 1: the scene's still, approved before any video is paid for.
    if (operation === 'keyframe') {
      return runStillJob({ request, body, user, atCost, sceneId, projectId });
    }

    // Lip sync: the server picks the take and cuts the exact song slice, so
    // the price always matches the audio length the provider bills for.
    let lipSync = null;
    if (operation === 'lip_sync') {
      if (!sceneId) return safeError('Choose a scene to lip sync.', 400);
      const timed = await selectOne('scenes', { id: `eq.${sceneId}` }, 'id,project_id,start_ms,end_ms,lip_sync');
      const windowMs = Number(timed?.end_ms) - Number(timed?.start_ms);
      if (!timed || timed.start_ms === null || !(windowMs > 0)) {
        return safeError('This scene is not synced to the song yet. Sync your lyrics first.', 409);
      }
      // A price check may run before the scene has a take; starting may not.
      const pricingOnly = quoteOnly || preflight === true;
      let source = null;
      if (sourceVersionId || !pricingOnly) {
        if (!sourceVersionId || typeof sourceVersionId !== 'string') return safeError('Choose the take to lip sync.', 400);
        source = await selectOne(
          'scene_versions',
          { id: `eq.${sourceVersionId}`, scene_id: `eq.${sceneId}`, status: 'eq.completed' },
          'id,output_url,kind'
        );
        if (!source?.output_url || source.kind === 'lip_sync') return safeError('Generate this scene first, then lip sync its take.', 409);
      }
      const song = await projectSong(timed.project_id);
      if (!song) return safeError('Upload your song first.', 409);
      lipSync = { scene: timed, source, song, seconds: Math.max(1, Math.ceil(windowMs / 1000)) };
      input = { video_url: source?.output_url || 'pending-take' };
    }

    // Real faces: a scene linked to a consented character photo is generated
    // from a photoreal first frame of that person (image-to-video). The server
    // decides this, so the face can't be skipped and the price always
    // includes both steps.
    let likeness = null;
    if (operation === 'video' && sceneId) {
      likeness = await resolveSceneLikeness(sceneId);
      if (likeness) model = LIKENESS_VIDEO_MODEL;
    }

    // Step 2: animate the approved still. Sung scenes of 5 s or more become
    // one-step performances (still + their slice of the song, lip sync built
    // in); everything else is image-to-video from the still.
    let fromStill = null;
    let perform = null;
    let motion = null;
    let beat = null;
    if (operation === 'video' && sceneId && body.use_keyframe === true) {
      const sc = await selectOne('scenes', { id: `eq.${sceneId}` }, 'id,project_id,title,purpose,prompt,shot_direction,start_ms,end_ms,duration_seconds,lip_sync,lyric_text,keyframe_url,keyframe_approved,motion_asset_id,motion_start_ms');
      if (!sc?.keyframe_url || sc.keyframe_approved !== true) {
        return safeError("Approve this scene's still first, then animate it.", 409);
      }
      fromStill = sc;
      model = LIKENESS_VIDEO_MODEL;
      const windowMs = Number(sc.end_ms) - Number(sc.start_ms);
      // engine 'two_step' = the fallback when the singing model is busy:
      // clip from the still, then a separate lip sync (priced separately).
      const twoStep = body.engine === 'two_step';
      // Dance shot: real moves copied from the scene's dance clip. Takes
      // precedence; a sung dance shot gets a separate lip sync afterwards.
      const clip = await sceneMotion(sc);
      if (clip) {
        const lengthMs = sc.start_ms !== null && windowMs > 0 ? windowMs : Math.round(Number(sc.duration_seconds || 0) * 1000);
        if (lengthMs < MOTION_MIN_MS) return safeError('Dance shots need a scene of at least 3 seconds.', 409);
        if (lengthMs > MOTION_MAX_MS) return safeError('Dance shots can be up to 30 seconds. Split this scene first.', 409);
        motion = { scene: sc, asset: clip, lengthMs, seconds: Math.ceil(lengthMs / 1000) };
        model = MOTION_MODEL;
      } else if (beatDanceFor(sc, parseShotDirection(sc.shot_direction).dance)) {
        // Dance shot timed to the song: the still + its slice of the track.
        const song = await projectSong(sc.project_id);
        if (!song) return safeError('Upload your song first.', 409);
        const plan = beatDanceFor(sc, parseShotDirection(sc.shot_direction).dance);
        beat = { scene: sc, song, ...plan };
        model = BEAT_DANCE_MODEL;
      } else if (!twoStep && sc.lip_sync && sc.start_ms !== null && windowMs >= PERFORM_MIN_MS && windowMs <= PERFORM_MAX_MS) {
        const song = await projectSong(sc.project_id);
        if (!song) return safeError('Upload your song first.', 409);
        // Priced on the padded audio actually sent (see sliceSongForScene).
        const audioMs = Math.max(windowMs, PERFORM_AUDIO_MIN_MS);
        perform = { scene: sc, song, audioMs, seconds: Math.ceil(audioMs / 1000) };
        model = PERFORM_MODEL;
      }
    }

    // Server-side price rule. Only active, customer-visible models are allowed.
    const rule = await selectOne(
      'model_cost_rules',
      { model: `eq.${model}`, operation: `eq.${operation}`, active: 'eq.true' },
      'provider,provider_cost_cents,max_duration_seconds,max_references,fixed_overhead_cents,variable_overhead_percent,payment_fee_fixed_cents,payment_fee_percent,minimum_customer_price_cents'
    );
    if (!rule) return safeError('That creative option is not available.', 409);

    // Price exactly what is sent to the provider. Never trust duplicate
    // top-level values that can disagree with the provider payload.
    const durationSeconds = lipSync ? lipSync.seconds : perform ? perform.seconds : motion ? motion.seconds : beat ? beat.seconds : Number(input.duration_seconds ?? input.duration ?? requestedDuration);
    const resolution = input.resolution ?? requestedResolution;
    let referenceCount;
    try {
      referenceCount = referenceCountFor(input);
    } catch {
      return safeError('References must be valid URLs or asset identifiers.', 400);
    }
    if (!Number.isInteger(durationSeconds) || durationSeconds <= 0) {
      return safeError('Duration must be a positive whole number.', 400);
    }
    if (rule.max_duration_seconds && durationSeconds > rule.max_duration_seconds) {
      return safeError(`This option supports up to ${rule.max_duration_seconds} seconds.`, 409);
    }
    if (rule.max_references !== null && referenceCount > rule.max_references) {
      return safeError('Too many references for this option.', 409);
    }

    const jobCostCents = providerCostCents({
      model,
      operation,
      durationSeconds,
      resolution,
      ruleCostCents: rule.provider_cost_cents,
    // The still is paid for in step 1, so animating it adds no keyframe cost.
    }) + (likeness && !fromStill ? keyframeCents(resolution) : 0);
    const quote = await callRpc('quote_generation', {
      p_provider: rule.provider,
      p_model: model,
      p_operation: operation,
      // Real per-second / per-resolution provider cost, not a flat per-job figure.
      p_provider_cost_cents: jobCostCents,
      p_duration_seconds: durationSeconds,
      p_resolution: resolution,
      p_reference_count: referenceCount,
    });
    const quoteRow = Array.isArray(quote.data) ? quote.data[0] : quote.data;
    if (!quote.ok || !quoteRow?.approved) {
      return safeError('This creative setup is temporarily unavailable.', 409);
    }

    const listCredits = Number(quoteRow.credits);
    // Subscribers pay a lower markup (still above the plan's margin floor).
    const planCode = atCost ? null : await planCodeFor(user.id);
    const credits = atCost
      ? atCostCredits(jobCostCents)
      : planCode ? planCredits({ rule, providerCostCents: jobCostCents, listCredits, planCode }) : listCredits;
    if (quoteOnly) {
      return Response.json({
        credits_required: credits,
        list_credits: listCredits,
        plan_code: planCode,
        engine: perform ? 'perform' : motion ? 'motion' : beat ? 'beat_dance' : fromStill ? 'still' : likeness ? 'real_face' : 'text',
        duration_seconds: durationSeconds,
        model,
        operation,
        at_cost: atCost,
        real_face: Boolean(likeness),
      });
    }
    const runtimeSignals = await loadRuntimeSafetySignals({
      userId: user.id,
      requestedCredits: credits,
      selectOneFn: selectOne,
      selectRowsFn: selectRows,
    });
    if (preflight === true) {
      const wallet = await selectOne('credit_wallets', { user_id: `eq.${user.id}` }, 'balance');
      if (atCost) {
        const paid = await callRpc('paid_credits_available', { p_user_id: user.id });
        const paidAvailable = paid.ok ? Number(Array.isArray(paid.data) ? paid.data[0] : paid.data) || 0 : 0;
        return Response.json(buildPreflightReport({
          credits,
          balance: paidAvailable,
          risk: evaluateReservationRisk(runtimeSignals.risk, credits),
          exposure: evaluateProviderExposure(runtimeSignals.exposure),
          providerKeyPresent: Boolean(process.env.MUAPI_API_KEY),
          atCost: true,
        }));
      }
      return Response.json(buildPreflightReport({
        credits,
        balance: wallet?.balance ?? 0,
        risk: evaluateReservationRisk(runtimeSignals.risk, credits),
        exposure: evaluateProviderExposure(runtimeSignals.exposure),
        providerKeyPresent: Boolean(process.env.MUAPI_API_KEY),
      }));
    }
    const risk = evaluateReservationRisk(runtimeSignals.risk, credits);
    if (risk.decision === 'blocked') {
      return safeError('This request could not be started right now.', 403);
    }
    const exposure = evaluateProviderExposure(runtimeSignals.exposure);
    if (exposure.decision !== 'allowed') {
      return safeError('This creative option is temporarily at capacity.', 503);
    }
    if (!Number.isInteger(Number(confirmedMaxCredits)) || Number(confirmedMaxCredits) < credits) {
      return safeError('The generation price changed. Review the updated credit total before continuing.', 409);
    }
    if (!request.headers.get('idempotency-key')) {
      return safeError('An idempotency key is required.', 400);
    }
    const idempotencyKey = request.headers.get('idempotency-key');
    let reference = null;
    {
      // At-cost jobs may only spend purchased credits (bonus credits would mean
      // paying the provider bill with money nobody paid us).
      const reservation = await callRpc(atCost ? 'reserve_paid_credits_v1' : 'reserve_credits_v2', {
        p_user_id: user.id,
        p_operation: operation,
        p_estimated_credits: credits,
        p_max_reservation_credits: credits,
        p_pricing_policy_version: atCost ? AT_COST_POLICY : planCode ? PLAN_PRICING_POLICY : '2026-09-06-v1',
        p_idempotency_key: idempotencyKey,
      });
      const reservationRow = Array.isArray(reservation.data) ? reservation.data[0] : reservation.data;
      if (!reservation.ok || !reservationRow?.id) {
        const message = String(reservation.data?.message || '');
        if (message.includes('INSUFFICIENT_PAID_CREDITS')) {
          return safeError(`At-cost generation uses purchased credits only. This scene needs ${credits} purchased credits.`, 402);
        }
        if (message.includes('INSUFFICIENT_CREDITS')) {
          return safeError('You need more credits to continue.', 402);
        }
        if (message.includes('IDEMPOTENCY_KEY_CONFLICT')) {
          return safeError('This generation request conflicts with an earlier request.', 409);
        }
        return safeError('Could not reserve credits. Please try again.', 409);
      }
      reference = reservationRow.id;
      if (reservationRow.generation_job_id) {
        const existingJob = await selectOne(
          'generation_requests',
          { id: `eq.${reservationRow.generation_job_id}`, user_id: `eq.${user.id}` },
          'id,provider_request_id,credits_reserved,scene_version,status'
        );
        if (existingJob) {
          return Response.json(
            {
              job_id: existingJob.id,
              request_id: existingJob.provider_request_id,
              credits_required: existingJob.credits_reserved,
              scene_version: existingJob.scene_version,
              status: existingJob.status,
            },
            { status: 202 }
          );
        }
      }
    }

    // Track the next take number so regeneration never overwrites a live scene.
    let sceneVersion = null;
    if (sceneId) {
      const scene = await selectOne('scenes', { id: `eq.${sceneId}` }, 'active_version');
      const latest = await selectOne(
        'scene_versions',
        { scene_id: `eq.${sceneId}`, order: 'version.desc' },
        'version'
      );
      sceneVersion = (latest?.version ?? scene?.active_version ?? 0) + 1;
      await insertRows('scene_versions', {
        scene_id: sceneId,
        version: sceneVersion,
        prompt: lipSync ? 'Lip sync to the song' : perform ? 'Sung performance' : typeof input?.prompt === 'string' ? input.prompt : null,
        status: 'pending',
        ...(lipSync ? { kind: 'lip_sync', source_version_id: lipSync.source.id } : {}),
        // A one-step performance is already lip-synced to the vocal.
        ...(perform ? { kind: 'lip_sync' } : {}),
      });
      await updateRows('scenes', { id: `eq.${sceneId}` }, { status: 'generating' });
    }

    const job = await insertRows('generation_requests', {
      user_id: user.id,
      project_id: projectId,
      scene_id: sceneId,
      scene_version: sceneVersion,
      provider: rule.provider,
      model,
      operation,
      reservation_reference: reference,
      credits_reserved: credits,
      // Real provider cost (per second and resolution), used for partner revenue.
      provider_cost_cents: Math.ceil(jobCostCents),
      funding_source: 'credits',
      idempotency_key: idempotencyKey,
      status: 'queued',
    });
    let jobRow = job.data?.[0] || null;
    if (!job.ok) {
      jobRow = await selectOne(
        'generation_requests',
        { user_id: `eq.${user.id}`, idempotency_key: `eq.${idempotencyKey}` },
        'id,provider_request_id,credits_reserved,scene_version,status'
      );
      if (!jobRow) {
        if (reference) await callRpc('release_reservation_v2', {
          p_reservation_id: reference,
          p_reason: 'job_record_failed',
        });
        return safeError('Generation could not be started. Please try again.', 500);
      }
      return Response.json(
        {
          job_id: jobRow.id,
          request_id: jobRow.provider_request_id,
          credits_required: jobRow.credits_reserved,
          scene_version: jobRow.scene_version,
          status: jobRow.status,
        },
        { status: 202 }
      );
    }
    const jobId = jobRow?.id || null;
    if (!jobId) {
      if (reference) await callRpc('release_reservation_v2', {
        p_reservation_id: reference,
        p_reason: 'job_record_failed',
      });
      return safeError('Generation could not be started. Please try again.', 500);
    }
    if (reference) {
      await updateRows(
        'credit_reservations',
        { id: `eq.${reference}` },
        { generation_job_id: jobId }
      );
    }

    const submissionStarted = await updateRows(
      'generation_requests',
      { id: `eq.${jobId}`, status: 'eq.queued' },
      { provider_submission_started_at: new Date().toISOString() }
    );
    if (!submissionStarted.ok) {
      if (reference) await callRpc('release_reservation_v2', {
        p_reservation_id: reference,
        p_reason: 'submission_marker_failed',
      });
      return safeError('Generation could not be started. Your credits were returned.', 503);
    }

    let providerRequestId = null;
    try {
      const apiKey = requireSecret('MUAPI_API_KEY');
      const base = process.env.MUAPI_BASE_URL || 'https://api.muapi.ai';
      let slice = null;
      const sung = lipSync || perform;
      if (sung) {
        const owner = await selectOne('projects', { id: `eq.${sung.scene.project_id}` }, 'owner_id');
        slice = await sliceSongForScene({
          song: sung.song,
          sceneId,
          ownerId: owner?.owner_id || user.id,
          projectId: sung.scene.project_id,
          startMs: Number(sung.scene.start_ms),
          endMs: Number(sung.scene.end_ms),
          ...(perform ? { minMs: perform.audioMs } : {}),
        });
        if (Math.ceil(slice.durationMs / 1000) > durationSeconds) throw new Error('song slice longer than priced');
      }
      let moves = null;
      if (motion) {
        const owner = await selectOne('projects', { id: `eq.${motion.scene.project_id}` }, 'owner_id');
        moves = await trimMotionClip({
          asset: motion.asset,
          sceneId,
          ownerId: owner?.owner_id || user.id,
          projectId: motion.scene.project_id,
          startMs: Number(motion.scene.motion_start_ms) || 0,
          lengthMs: motion.lengthMs,
        });
      }
      let beatSlice = null;
      if (beat) {
        const owner = await selectOne('projects', { id: `eq.${beat.scene.project_id}` }, 'owner_id');
        beatSlice = await sliceForBeatDance({
          song: beat.song,
          sceneId,
          ownerId: owner?.owner_id || user.id,
          projectId: beat.scene.project_id,
          startMs: beat.scene.start_ms === null ? 0 : Number(beat.scene.start_ms),
          seconds: beat.seconds,
        });
      }
      let firstFrame = fromStill ? fromStill.keyframe_url : null;
      if (likeness && !fromStill) {
        firstFrame = await makeKeyframe({
          base,
          apiKey,
          asset: likeness.asset,
          scenePrompt: input.prompt,
          aspectRatio: input.aspect_ratio,
          resolution,
          singing: Boolean(likeness.scene.lip_sync),
        });
      }
      const canonicalInput = beat ? {
        prompt: beatDancePrompt({ scenePrompt: beat.scene.prompt || input.prompt, bpm: beatSlice.bpm }),
        images_list: [firstFrame],
        audio_files: [beatSlice.url],
        aspect_ratio: beatAspect(input.aspect_ratio),
        duration: beat.seconds,
      } : motion ? {
        prompt: motionPrompt(),
        image_url: firstFrame,
        video_url: moves.url,
        // Follow the dancer's body orientation (allows up to 30 s).
        character_orientation: 'video',
        keep_original_sound: false,
      } : perform ? {
        image_url: firstFrame,
        audio_url: slice.url,
        prompt: performPrompt(perform.scene.lyric_text),
        output_resolution: resolution === '1080p' ? '1080' : '720',
      } : (likeness || fromStill) ? {
        prompt: likeness ? likenessMotionPrompt(input.prompt) : String(input.prompt || '').slice(0, 2000),
        images_list: [firstFrame],
        duration: durationSeconds,
        ...(resolution ? { resolution } : {}),
        thinking_type: 'disabled',
        generate_audio_switch: false,
      } : lipSync ? {
        video_url: lipSync.source.output_url,
        audio_url: slice.url,
        // Lite = one frontal face. separate_vocal pulls the voice out of the
        // full mix so drums and bass never drive the mouth.
        mode: 'lite',
        separate_vocal: true,
        align_audio: true,
      } : {
        ...Object.fromEntries(
          Object.entries(input).filter(([field]) => SAFE_PROVIDER_FIELDS.has(field))
        ),
        duration: durationSeconds,
        ...(Object.hasOwn(input, 'duration_seconds') ? { duration_seconds: durationSeconds } : {}),
        ...(resolution ? { resolution } : {}),
      };
      const providerEndpoint = providerEndpointFor(model);
      const providerResponse = await fetch(`${base}/api/v1/${providerEndpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
        body: JSON.stringify(canonicalInput),
      });
      const providerText = await providerResponse.text();
      let providerData = null;
      try {
        providerData = providerText ? JSON.parse(providerText) : null;
      } catch {
        providerData = null;
      }
      if (!providerResponse.ok) {
        console.error('generate provider rejected', {
          status: providerResponse.status,
          model: providerEndpoint,
          response: providerText.slice(0, 300),
        });
        throw new Error(`provider rejected the job (${providerResponse.status})`);
      }

      providerRequestId = providerData?.request_id || providerData?.id;
      if (!providerRequestId) throw new Error('provider returned no job id');

      let persisted = false;
      for (let attempt = 0; attempt < 3 && !persisted; attempt += 1) {
        const update = await updateRows(
          'generation_requests',
          { id: `eq.${jobId}` },
          // The input is kept so a "provider busy" failure can be resubmitted.
          { provider_request_id: providerRequestId, status: 'running', output: retryState({ endpoint: providerEndpoint, input: canonicalInput }) }
        );
        persisted = update.ok;
        if (!persisted && attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** attempt));
        }
      }
      if (!persisted) {
        const fallback = await callRpc('mark_generation_started', {
          p_generation_job_id: jobId,
          p_provider_request_id: providerRequestId,
        });
        persisted = fallback.ok && fallback.data === true;
      }
      if (!persisted) throw new Error('provider job accepted but tracking persistence failed');

      return Response.json(
        { job_id: jobId, request_id: providerRequestId, credits_required: credits, at_cost: atCost, scene_version: sceneVersion },
        { status: 202 }
      );
    } catch (providerError) {
      console.error('generate provider failure', providerError);
      if (providerRequestId) {
        // The provider has accepted this job. Never refund it as "not started";
        // retain the reservation and log both identifiers for reconciliation.
        return safeError(
          `Generation was accepted but tracking is delayed. Support reference: ${jobId}.`,
          503
        );
      }
      if (reference) await callRpc('release_reservation_v2', {
        p_reservation_id: reference,
        p_reason: 'provider_error',
      });
      await updateRows(
        'generation_requests',
        { id: `eq.${jobId}` },
        { status: 'released', error_note: 'provider_error' }
      );
      if (sceneId) {
        await updateRows('scenes', { id: `eq.${sceneId}` }, { status: 'failed' });
        if (sceneVersion) {
          await updateRows(
            'scene_versions',
            { scene_id: `eq.${sceneId}`, version: `eq.${sceneVersion}` },
            { status: 'failed' }
          );
        }
      }
      if (providerError?.code === 'MOTION_TOO_SHORT') {
        return safeError(`Your dance clip runs out before this scene ends (${(providerError.availableMs / 1000).toFixed(1)} s left after the start point). Choose an earlier start or a longer clip. Your credits were returned.`, 422);
      }
      if (providerError instanceof FaceMismatchError) {
        return safeError(`We couldn't keep ${likeness?.asset?.name || 'this person'}'s face accurate in this shot, so nothing was made and your credits were returned. Try a sharper, front-facing photo or a simpler scene description.`, 422);
      }
      return safeError('Generation could not be started. Your credits were returned.', 502);
    }
  } catch (err) {
    console.error('generate route', err);
    return safeError('Generation could not be started.', 500);
  }
}
