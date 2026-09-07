import {
  guard,
  callRpc,
  selectOne,
  updateRows,
  insertRows,
  requireSecret,
  safeError,
} from '../../../../lib/cinexvideo-server';
import { normalizeMuapiCost } from '../../../../lib/providers/muapi-cost-adapter.js';

function normaliseStatus(raw) {
  const value = String(raw || '').toLowerCase();
  if (['completed', 'succeeded', 'success', 'done'].includes(value)) return 'completed';
  if (['failed', 'error', 'cancelled', 'canceled'].includes(value)) return 'failed';
  return 'running';
}

/**
 * True when reservation_reference points at a row in the new
 * credit_reservations table rather than the legacy free-text reference used
 * by consume_credits/release_credits.
 */
async function findCreditReservation(referenceId) {
  if (!referenceId) return null;
  return selectOne('credit_reservations', { id: `eq.${referenceId}` }, 'id,status,max_reservation_credits');
}

function firstUrl(output) {
  if (!output) return null;
  if (typeof output === 'string') return output;
  if (Array.isArray(output)) return firstUrl(output[0]);
  return output.url || output.video_url || output.image_url || output.output_url || null;
}

/**
 * Poll a generation and settle it exactly once.
 *
 * Completion consumes the reserved credits; failure returns them. The
 * generation_requests row is the idempotency guard, so repeated polling from an
 * open browser tab can never double-charge or double-refund.
 */
export async function GET(request, { params }) {
  const { user, error } = await guard(request);
  if (error) return error;
  const { requestId } = await params;

  try {
    const job = await selectOne('generation_requests', {
      provider_request_id: `eq.${requestId}`,
      user_id: `eq.${user.id}`,
    });
    if (!job) return safeError('Generation not found.', 404);

    // Already settled — report the stored outcome without calling the provider.
    if (['completed', 'failed', 'released'].includes(job.status)) {
      return Response.json({
        status: job.status === 'released' ? 'failed' : job.status,
        output_url: firstUrl(job.output),
        scene_version: job.scene_version,
        settled: true,
      });
    }

    const apiKey = requireSecret('MUAPI_API_KEY');
    const base = process.env.MUAPI_BASE_URL || 'https://api.muapi.ai';
    const response = await fetch(
      `${base}/api/v1/predictions/${encodeURIComponent(requestId)}/result`,
      { headers: { Authorization: `Bearer ${apiKey}` }, cache: 'no-store' }
    );
    const data = await response.json().catch(() => null);
    if (!response.ok) return safeError('Generation status is temporarily unavailable.', 502);

    const status = normaliseStatus(data?.status || data?.state);
    const output = data?.output || data?.result || null;
    const outputUrl = firstUrl(output);

    if (status === 'running') {
      return Response.json({ status: 'running', output_url: null, scene_version: job.scene_version });
    }

    if (status === 'completed') {
      const costNormalized = normalizeMuapiCost({
        response: data,
        headers: Object.fromEntries(response.headers.entries()),
      });
      const reservation = await findCreditReservation(job.reservation_reference);
      if (reservation) {
        if (reservation.status === 'reserved') {
          const actualCredits = Number.isInteger(costNormalized.amountCredits)
            ? Math.min(Math.max(0, costNormalized.amountCredits), reservation.max_reservation_credits)
            : costNormalized.amountUsdCents == null
              ? reservation.max_reservation_credits
              : Math.min(Math.max(0, costNormalized.amountUsdCents), reservation.max_reservation_credits);
          const settlement = await callRpc('settle_reservation_v2', {
            p_reservation_id: reservation.id,
            p_settled_credits: actualCredits,
            p_generation_job_id: job.id,
          });
          if (!settlement.ok) throw new Error('reservation settlement failed');
        }
      } else {
        const consume = await callRpc('consume_credits', {
          p_user_id: user.id,
          p_credits: job.credits_reserved,
          p_reference_id: job.reservation_reference,
        });
        if (!consume.ok) throw new Error('legacy credit settlement failed');
      }
      if (costNormalized.reliable && costNormalized.amountUsdCents != null) {
        const costRecord = await callRpc('record_provider_cost_once', {
          p_reservation_id: reservation?.id || null,
          p_generation_job_id: job.id,
          p_provider: 'muapi',
          p_provider_request_id: costNormalized.providerRequestId,
          p_actual_cost_cents: costNormalized.amountUsdCents,
          p_raw_response: data,
        });
        if (!costRecord.ok) throw new Error('provider cost could not be recorded');
      }
      const completedUpdate = await updateRows(
        'generation_requests',
        { id: `eq.${job.id}` },
        {
          status: 'completed',
          output,
          provider_cost_status: costNormalized.reliable ? 'recorded' : 'pending',
        }
      );
      if (!completedUpdate.ok) throw new Error('generation completion could not be recorded');

      // Revenue is recognised here, not at purchase: this is the point where
      // the credits are actually spent and the provider cost is incurred.
      // record_revenue is idempotent on the request id, so a duplicate poll
      // cannot pay partners twice.
      await callRpc('settle_generation_revenue', { p_generation_request_id: job.id });

      if (job.scene_id && job.scene_version) {
        await updateRows(
          'scene_versions',
          { scene_id: `eq.${job.scene_id}`, version: `eq.${job.scene_version}` },
          { status: 'completed', output_url: outputUrl }
        );
        // A finished take waits for approval; it does not silently replace the
        // scene the user already signed off on.
        await updateRows('scenes', { id: `eq.${job.scene_id}` }, { status: 'needs_review' });
      }

      await insertRows('admin_metric_events', {
        event_type: 'generation_completed',
        operation: job.operation,
        model: job.model,
        user_id: user.id,
        credits: job.credits_reserved,
        status: 'completed',
      });

      return Response.json({
        status: 'completed',
        output_url: outputUrl,
        scene_version: job.scene_version,
        settled: true,
      });
    }

    // Failure path — the customer gets their credits back.
    const reservation = await findCreditReservation(job.reservation_reference);
    if (reservation) {
      if (reservation.status === 'reserved') {
        const release = await callRpc('release_reservation_v2', {
          p_reservation_id: reservation.id,
          p_reason: 'provider_failed',
        });
        if (!release.ok) throw new Error('reservation release failed');
      }
    } else {
      const release = await callRpc('release_credits', {
        p_user_id: user.id,
        p_credits: job.credits_reserved,
        p_reference_id: job.reservation_reference,
      });
      if (!release.ok) throw new Error('legacy credit release failed');
    }
    const failedUpdate = await updateRows(
      'generation_requests',
      { id: `eq.${job.id}` },
      { status: 'released', error_note: 'provider_failed' }
    );
    if (!failedUpdate.ok) throw new Error('generation failure could not be recorded');
    if (job.scene_id) {
      await updateRows('scenes', { id: `eq.${job.scene_id}` }, { status: 'failed' });
      if (job.scene_version) {
        await updateRows(
          'scene_versions',
          { scene_id: `eq.${job.scene_id}`, version: `eq.${job.scene_version}` },
          { status: 'failed' }
        );
      }
    }
    await insertRows('admin_metric_events', {
      event_type: 'generation_failed',
      operation: job.operation,
      model: job.model,
      user_id: user.id,
      credits: job.credits_reserved,
      status: 'failed',
    });

    return Response.json({
      status: 'failed',
      output_url: null,
      scene_version: job.scene_version,
      credits_returned: job.credits_reserved,
      settled: true,
    });
  } catch (err) {
    console.error('job route', err);
    return safeError('Generation status is temporarily unavailable.', 502);
  }
}
