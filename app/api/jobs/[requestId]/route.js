import {
  guard,
  callRpc,
  selectOne,
  selectRows,
  updateRows,
  insertRows,
  requireSecret,
  safeError,
} from '../../../../lib/cinexvideo-server';
import { archiveSoon } from '../../../../lib/storage/archive.js';
import { handleModeration } from '../../../../lib/moderation/cases.js';
import { checkTakeOnce } from '../../../../lib/moderation/take-check.js';
import { blockedPayload, suggestSafeAlternative } from '../../../../lib/moderation/alternative.js';
import { normalizeMuapiCost } from '../../../../lib/providers/muapi-cost-adapter.js';
import { settledGenerationCredits } from '../../../../lib/billing/at-cost.js';
import { rateLimit } from '../../../../lib/rate-limit';
import { muapiOutput, firstOutputUrl } from '../../../../lib/providers/muapi-output.js';
import { attemptIsStuck, handleFailover } from '../../../../lib/generation/failover.js';
import { currentRequestId, handleBusyFailure } from '../../../../lib/generation/busy-retry.js';

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
  return selectOne('credit_reservations', { id: `eq.${referenceId}` }, 'id,status,max_reservation_credits,pricing_policy_version');
}

const firstUrl = firstOutputUrl;

/**
 * Poll a generation and settle it exactly once.
 *
 * Completion consumes the reserved credits; failure returns them. The
 * generation_requests row is the idempotency guard, so repeated polling from an
 * open browser tab can never double-charge or double-refund.
 */
export async function GET(request, { params }) {
  const { user, admin, error } = await guard(request);
  if (error) return error;
  const limited = rateLimit(`jobs:${user.id}`, { limit: 120, windowMs: 60_000 });
  if (limited) return limited;
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
      `${base}/api/v1/predictions/${encodeURIComponent(currentRequestId(job) || requestId)}/result`,
      { headers: { 'x-api-key': apiKey }, cache: 'no-store' }
    );
    const data = await response.json().catch(() => null);
    const status = normaliseStatus(data?.status || data?.state || data?.data?.status || data?.detail?.status);
    // MUAPI can answer a failed job with an error status code. A clear
    // "failed" status is final (credits are returned below); anything else is
    // reported so it can be diagnosed instead of polling forever.
    if (!response.ok && status !== 'failed') {
      const raw = data?.error ?? data?.detail ?? data?.message ?? data;
      const detail = (typeof raw === 'string' ? raw : JSON.stringify(raw ?? '')).slice(0, 400);
      console.error('job status not ok', { requestId, status: response.status, detail });
      return Response.json(
        { error: 'Generation status is temporarily unavailable.', ...(admin ? { provider_status: response.status, provider_detail: detail } : {}) },
        { status: 502 }
      );
    }
    const output = muapiOutput(data);
    const outputUrl = firstUrl(output);

    if (status === 'running') {
      // A model that sits on a job far longer than it ever should is treated
      // as failed, so the job moves to the next model instead of hanging.
      if (!attemptIsStuck(job)) {
        return Response.json({ status: 'running', output_url: null, scene_version: job.scene_version });
      }
      console.warn('job stuck at provider, failing over', { requestId, model: job.output?.busy_retry?.endpoint || job.model });
      const over = await handleFailover({ job, base, apiKey, updateRows, insertRows });
      if (over.action === 'failed_over' || over.action === 'claimed_elsewhere') {
        return Response.json({ status: 'running', output_url: null, scene_version: job.scene_version, failover: over.model || true });
      }
      // No model left: fall through to the failure path (full refund).
    }

    // A "completed" result with no usable video link is treated as a failure:
    // the customer gets their credits back instead of paying for nothing.
    // Every finished take is checked (start, middle and end frames) before it
    // is charged or shown. A blocked take is withheld, refunded and sent to
    // the super admin's review queue.
    let blockedTake = null;
    if (status === 'completed' && outputUrl) {
      const verdict = await checkTakeOnce(job.id, outputUrl);
      if (verdict.pending) return Response.json({ status: 'running', output_url: null, scene_version: job.scene_version, checking: true });
      await handleModeration(verdict, { userId: user.id, kind: 'take', where: `take_${job.operation || 'video'}`, projectId: job.project_id || null, sceneId: job.scene_id || null, mediaUrl: outputUrl }, { insertRows, updateRows });
      if (!verdict.allowed) blockedTake = verdict;
    }
    if (status === 'completed' && outputUrl && !blockedTake) {
      const costNormalized = normalizeMuapiCost({
        response: data,
        headers: Object.fromEntries(response.headers.entries()),
      });
      const platformJob = job.funding_source === 'platform';
      const reservation = platformJob ? null : await findCreditReservation(job.reservation_reference);
      if (platformJob) {
        // Platform-funded (super admin): no credits to settle. Record the real cost below.
      } else if (reservation) {
        if (reservation.status === 'reserved') {
          // Customers pay the price they confirmed; at-cost (super admin) jobs pay
          // the provider's reported cost plus card fees, capped at the confirmed price.
          const actualCredits = settledGenerationCredits(reservation, costNormalized);
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
        if (platformJob) {
          await updateRows('platform_funded_usage', { generation_job_id: `eq.${job.id}` }, { estimated_cost_cents: costNormalized.amountUsdCents });
        }
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
      if (!platformJob) await callRpc('settle_generation_revenue', { p_generation_request_id: job.id });

      if (job.scene_id && job.scene_version) {
        const savedTake = await updateRows(
          'scene_versions',
          { scene_id: `eq.${job.scene_id}`, version: `eq.${job.scene_version}` },
          { status: 'completed', output_url: outputUrl }
        );
        // Copy the take into our own storage before the provider's link expires.
        archiveSoon('take', savedTake.data?.[0], { selectOne, selectRows, insertRows, updateRows });
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

    // The provider was at capacity: wait and resubmit (charged once, only on
    // delivery) instead of failing the customer's scene.
    const busy = blockedTake ? { action: 'not_busy' } : await handleBusyFailure({ job, data, httpStatus: response.status, base, apiKey, updateRows });
    if (busy.action === 'waiting' || busy.action === 'resubmitted') {
      return Response.json({ status: 'running', output_url: null, scene_version: job.scene_version, busy_retry: busy.attempt });
    }
    const busyExhausted = busy.action === 'exhausted';

    // The model failed this job: hand it to the next most reliable model with
    // the same inputs, at no extra cost to the customer (lib/generation/failover.js).
    if (!blockedTake) {
      const over = await handleFailover({ job, base, apiKey, updateRows, insertRows });
      if (over.action === 'failed_over' || over.action === 'claimed_elsewhere') {
        return Response.json({ status: 'running', output_url: null, scene_version: job.scene_version, failover: over.model || true });
      }
    }

    // Failure path — the customer gets their credits back. Keep the
    // provider's reason on the job so failures can be diagnosed.
    const reasonRaw = data?.error ?? data?.detail ?? data?.message ?? null;
    const providerReason = reasonRaw == null ? '' : (typeof reasonRaw === 'string' ? reasonRaw : JSON.stringify(reasonRaw)).slice(0, 400);
    const platformJob = job.funding_source === 'platform';
    const reservation = platformJob ? null : await findCreditReservation(job.reservation_reference);
    if (platformJob) {
      // Nothing to refund: platform-funded jobs never debited credits.
    } else if (reservation) {
      if (reservation.status === 'reserved') {
        const release = await callRpc('release_reservation_v2', {
          p_reservation_id: reservation.id,
          p_reason: blockedTake ? 'moderation_blocked' : 'provider_failed',
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
      { status: 'released', error_note: blockedTake ? `moderation_blocked: ${blockedTake.categories.join(',')}` : `${busyExhausted ? 'provider_busy' : 'provider_failed'}${providerReason ? `: ${providerReason}` : ''}`.slice(0, 500) }
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
      event_type: blockedTake ? 'generation_blocked' : 'generation_failed',
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
      ...(busyExhausted ? { busy: true } : {}),
      ...(blockedTake ? await blockedTakePayload(job, user, blockedTake) : {}),
      settled: true,
    });
  } catch (err) {
    console.error('job route', err);
    return Response.json(
      { error: 'Generation status is temporarily unavailable.', ...(admin ? { internal: String(err?.message || err).slice(0, 300) } : {}) },
      { status: 502 }
    );
  }
}

/** A withheld take: tell the user why and offer a safer scene description. */
async function blockedTakePayload(job, user, verdict) {
  const scene = job.scene_id ? await selectOne('scenes', { id: `eq.${job.scene_id}` }, 'prompt').catch(() => null) : null;
  const alternative = scene?.prompt ? await suggestSafeAlternative({ text: scene.prompt, decision: verdict, stage: 'result', userId: user.id }, { insertRows }) : null;
  const message = `This take came out looking like ${verdict.labels.join(', ')}, so we withheld it and returned your credits. ${alternative ? 'Here is a safer version of the scene to try instead.' : 'Please change the description and try again.'}`;
  return blockedPayload({ message, decision: verdict, alternative, stage: 'result', sceneId: job.scene_id || null });
}
