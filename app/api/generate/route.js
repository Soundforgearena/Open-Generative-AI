import {
  guard,
  callRpc,
  selectOne,
  insertRows,
  updateRows,
  requireSecret,
  safeError,
} from '../../../lib/cinexvideo-server';

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
  const { user, admin, error } = await guard(request, { blockOnMaintenance: true });
  if (error) return error;

  try {
    const body = await request.json();
    const {
      model,
      input,
      scene_id: sceneId = null,
      project_id: projectId = null,
      operation = 'video',
      duration_seconds: requestedDuration = 1,
      resolution: requestedResolution = null,
    } = body;

    if (!model || !input || typeof input !== 'object' || Array.isArray(input)) {
      return safeError('Generation settings are incomplete.');
    }
    if (!request.headers.get('idempotency-key')) {
      return safeError('An idempotency key is required.', 400);
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

    // Server-side price rule. Only active, customer-visible models are allowed.
    const rule = await selectOne(
      'model_cost_rules',
      { model: `eq.${model}`, operation: `eq.${operation}`, active: 'eq.true' },
      'provider,provider_cost_cents,max_duration_seconds,max_references'
    );
    if (!rule) return safeError('That creative option is not available.', 409);

    // Price exactly what is sent to the provider. Never trust duplicate
    // top-level values that can disagree with the provider payload.
    const durationSeconds = Number(input.duration_seconds ?? input.duration ?? requestedDuration);
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

    const quote = await callRpc('quote_generation', {
      p_provider: rule.provider,
      p_model: model,
      p_operation: operation,
      p_provider_cost_cents: rule.provider_cost_cents,
      p_duration_seconds: durationSeconds,
      p_resolution: resolution,
      p_reference_count: referenceCount,
    });
    const quoteRow = Array.isArray(quote.data) ? quote.data[0] : quote.data;
    if (!quote.ok || !quoteRow?.approved) {
      return safeError('This creative setup is temporarily unavailable.', 409);
    }

    const credits = Number(quoteRow.credits);
    const idempotencyKey = request.headers.get('idempotency-key');
    const reservation = await callRpc('reserve_credits_v2', {
      p_user_id: user.id,
      p_operation: operation,
      p_estimated_credits: credits,
      p_max_reservation_credits: credits,
      p_pricing_policy_version: '2026-09-06-v1',
      p_idempotency_key: idempotencyKey,
    });
    const reservationRow = Array.isArray(reservation.data) ? reservation.data[0] : reservation.data;
    if (!reservation.ok || !reservationRow?.id) {
      const message = String(reservation.data?.message || '');
      if (message.includes('INSUFFICIENT_CREDITS')) {
        return safeError('You need more credits to continue.', 402);
      }
      if (message.includes('IDEMPOTENCY_KEY_CONFLICT')) {
        return safeError('This generation request conflicts with an earlier request.', 409);
      }
      return safeError('Could not reserve credits. Please try again.', 409);
    }
    const reference = reservationRow.id;
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
        prompt: typeof input?.prompt === 'string' ? input.prompt : null,
        status: 'pending',
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
        await callRpc('release_reservation_v2', {
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
      await callRpc('release_reservation_v2', {
        p_reservation_id: reference,
        p_reason: 'job_record_failed',
      });
      return safeError('Generation could not be started. Please try again.', 500);
    }
    await updateRows(
      'credit_reservations',
      { id: `eq.${reference}` },
      { generation_job_id: jobId }
    );

    const submissionStarted = await updateRows(
      'generation_requests',
      { id: `eq.${jobId}`, status: 'eq.queued' },
      { provider_submission_started_at: new Date().toISOString() }
    );
    if (!submissionStarted.ok) {
      await callRpc('release_reservation_v2', {
        p_reservation_id: reference,
        p_reason: 'submission_marker_failed',
      });
      return safeError('Generation could not be started. Your credits were returned.', 503);
    }

    let providerRequestId = null;
    try {
      const apiKey = requireSecret('MUAPI_API_KEY');
      const base = process.env.MUAPI_BASE_URL || 'https://api.muapi.ai';
      const canonicalInput = {
        ...Object.fromEntries(
          Object.entries(input).filter(([field]) => SAFE_PROVIDER_FIELDS.has(field))
        ),
        duration: durationSeconds,
        ...(Object.hasOwn(input, 'duration_seconds') ? { duration_seconds: durationSeconds } : {}),
        ...(resolution ? { resolution } : {}),
      };
      const providerResponse = await fetch(`${base}/api/v1/${model}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(canonicalInput),
      });
      const providerData = await providerResponse.json().catch(() => null);
      if (!providerResponse.ok) throw new Error('provider rejected the job');

      providerRequestId = providerData?.request_id || providerData?.id;
      if (!providerRequestId) throw new Error('provider returned no job id');

      let persisted = false;
      for (let attempt = 0; attempt < 3 && !persisted; attempt += 1) {
        const update = await updateRows(
          'generation_requests',
          { id: `eq.${jobId}` },
          { provider_request_id: providerRequestId, status: 'running' }
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
        { job_id: jobId, request_id: providerRequestId, credits_required: credits, scene_version: sceneVersion },
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
      await callRpc('release_reservation_v2', {
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
      return safeError('Generation could not be started. Your credits were returned.', 502);
    }
  } catch (err) {
    console.error('generate route', err);
    return safeError('Generation could not be started.', 500);
  }
}
