import {
  guard,
  callRpc,
  selectOne,
  insertRows,
  updateRows,
  requireSecret,
  safeError,
} from '../../../lib/cinexvideo-server';

/**
 * Start a generation.
 *
 * Security note: the provider cost is looked up server-side from
 * model_cost_rules. It is never accepted from the request body — otherwise a
 * customer could post a cost of zero and drive the price below the internal
 * margin floor. The response exposes only the credit figure.
 */
export async function POST(request) {
  const { user, error } = await guard(request, { blockOnMaintenance: true });
  if (error) return error;

  try {
    const body = await request.json();
    const {
      model,
      input,
      scene_id: sceneId = null,
      project_id: projectId = null,
      operation = 'video',
      duration_seconds: durationSeconds = 1,
      resolution = null,
      reference_count: referenceCount = 0,
    } = body;

    if (!model || !input) return safeError('Generation settings are incomplete.');

    // Server-side price rule. Only active, customer-visible models are allowed.
    const rule = await selectOne(
      'model_cost_rules',
      { model: `eq.${model}`, operation: `eq.${operation}`, active: 'eq.true' },
      'provider,provider_cost_cents,max_duration_seconds,max_references'
    );
    if (!rule) return safeError('That creative option is not available.', 409);

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
    const idempotencyKey = request.headers.get('idempotency-key') || crypto.randomUUID();
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

    const reserved = await callRpc('reserve_credits', {
      p_user_id: user.id,
      p_credits: credits,
      p_reference_id: reference,
    });
    if (!reserved.ok || reserved.data !== true) {
      return safeError('You need more credits to continue.', 402);
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

    try {
      const apiKey = requireSecret('MUAPI_API_KEY');
      const base = process.env.MUAPI_BASE_URL || 'https://api.muapi.ai';
      const providerResponse = await fetch(`${base}/api/v1/${model}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(input),
      });
      const providerData = await providerResponse.json().catch(() => null);
      if (!providerResponse.ok) throw new Error('provider rejected the job');

      const providerRequestId = providerData?.request_id || providerData?.id;
      if (!providerRequestId) throw new Error('provider returned no job id');

      await updateRows(
        'generation_requests',
        { id: `eq.${jobId}` },
        { provider_request_id: providerRequestId, status: 'running' }
      );

      return Response.json(
        { job_id: jobId, request_id: providerRequestId, credits_required: credits, scene_version: sceneVersion },
        { status: 202 }
      );
    } catch (providerError) {
      console.error('generate provider failure', providerError);
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
