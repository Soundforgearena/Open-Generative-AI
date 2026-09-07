import {
  callRpc,
  insertRows,
  requireSecret,
  safeError,
  selectOne,
  selectRows,
  updateRows,
} from '../../../../../lib/cinexvideo-server';
import { normalizeMuapiCost } from '../../../../../lib/providers/muapi-cost-adapter.js';

export const dynamic = 'force-dynamic';

function normaliseStatus(raw) {
  const value = String(raw || '').toLowerCase();
  if (['completed', 'succeeded', 'success', 'done'].includes(value)) return 'completed';
  if (['failed', 'error', 'cancelled', 'canceled'].includes(value)) return 'failed';
  return 'running';
}

function firstUrl(output) {
  if (!output) return null;
  if (typeof output === 'string') return output;
  if (Array.isArray(output)) return firstUrl(output[0]);
  return output.url || output.video_url || output.image_url || output.output_url || null;
}

async function reservationFor(job) {
  if (!job.reservation_reference) return null;
  return selectOne(
    'credit_reservations',
    { id: `eq.${job.reservation_reference}` },
    'id,status,max_reservation_credits'
  );
}

async function completeJob(job, data, headers = {}) {
  const output = data?.output || data?.result || null;
  const outputUrl = firstUrl(output);
  const reservation = await reservationFor(job);
  const cost = normalizeMuapiCost({ response: data, headers });

  if (reservation?.status === 'reserved') {
    const actualCredits = Number.isInteger(cost.amountCredits)
      ? Math.min(Math.max(0, cost.amountCredits), reservation.max_reservation_credits)
      : cost.amountUsdCents == null
        ? reservation.max_reservation_credits
        : Math.min(Math.max(0, cost.amountUsdCents), reservation.max_reservation_credits);
    const settled = await callRpc('settle_reservation_v2', {
      p_reservation_id: reservation.id,
      p_settled_credits: actualCredits,
      p_generation_job_id: job.id,
    });
    if (!settled.ok) throw new Error('reservation settlement failed');
  } else if (!reservation) {
    const consumed = await callRpc('consume_credits', {
      p_user_id: job.user_id,
      p_credits: job.credits_reserved,
      p_reference_id: job.reservation_reference,
    });
    if (!consumed.ok) throw new Error('legacy credit settlement failed');
  }
  if (cost.reliable && cost.amountUsdCents != null) {
    const costWrite = await callRpc('record_provider_cost_once', {
      p_reservation_id: reservation?.id || null,
      p_generation_job_id: job.id,
      p_provider: 'muapi',
      p_provider_request_id: cost.providerRequestId,
      p_actual_cost_cents: cost.amountUsdCents,
      p_raw_response: data,
    });
    if (!costWrite.ok) throw new Error('provider cost could not be recorded');
  }

  const updated = await updateRows(
    'generation_requests',
    { id: `eq.${job.id}`, status: 'in.(queued,running)' },
    {
      status: 'completed',
      output,
      provider_cost_status: cost.reliable ? 'recorded' : 'pending',
    }
  );
  if (!updated.ok) throw new Error('generation completion could not be recorded');

  const revenue = await callRpc('settle_generation_revenue', {
    p_generation_request_id: job.id,
  });
  if (!revenue.ok) throw new Error('generation revenue could not be settled');

  if (job.scene_id && job.scene_version) {
    await updateRows(
      'scene_versions',
      { scene_id: `eq.${job.scene_id}`, version: `eq.${job.scene_version}` },
      { status: 'completed', output_url: outputUrl }
    );
    await updateRows('scenes', { id: `eq.${job.scene_id}` }, { status: 'needs_review' });
  }
}

async function failJob(job, reason = 'provider_failed') {
  const reservation = await reservationFor(job);
  if (reservation?.status === 'reserved') {
    const released = await callRpc('release_reservation_v2', {
      p_reservation_id: reservation.id,
      p_reason: reason,
    });
    if (!released.ok) throw new Error('reservation release failed');
  } else if (!reservation) {
    const released = await callRpc('release_credits', {
      p_user_id: job.user_id,
      p_credits: job.credits_reserved,
      p_reference_id: job.reservation_reference,
    });
    if (!released.ok) throw new Error('legacy credit release failed');
  }

  const updated = await updateRows(
    'generation_requests',
    { id: `eq.${job.id}`, status: 'in.(queued,running)' },
    { status: 'released', error_note: reason }
  );
  if (!updated.ok) throw new Error('generation failure could not be recorded');
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
}

export async function POST(request) {
  const expected = process.env.CRON_SECRET;
  const provided = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!expected || !provided || provided !== expected) {
    return safeError('Cron authorization required.', 401);
  }

  try {
    const apiKey = requireSecret('MUAPI_API_KEY');
    const base = process.env.MUAPI_BASE_URL || 'https://api.muapi.ai';
    const jobs = await selectRows(
      'generation_requests',
      {
        status: 'in.(queued,running,completed)',
        provider_request_id: 'not.is.null',
        provider_cost_status: 'eq.pending',
        order: 'created_at.asc',
        limit: 50,
      }
    );
    const abandoned = await selectRows(
      'generation_requests',
      {
        status: 'eq.queued',
        provider_request_id: 'is.null',
        provider_submission_started_at: 'is.null',
        created_at: `lt.${new Date(Date.now() - 15 * 60 * 1000).toISOString()}`,
        order: 'created_at.asc',
        limit: 50,
      }
    );

    const summary = { checked: jobs.length, completed: 0, failed: 0, running: 0, released: 0, errors: 0 };
    for (const job of abandoned) {
      try {
        await failJob(job, 'provider_not_started');
        summary.released += 1;
      } catch (error) {
        summary.errors += 1;
        console.error('abandoned generation reconciliation failed', job.id, error);
      }
    }

    for (const job of jobs) {
      try {
        const response = await fetch(
          `${base}/api/v1/predictions/${encodeURIComponent(job.provider_request_id)}/result`,
          { headers: { Authorization: `Bearer ${apiKey}` }, cache: 'no-store' }
        );
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(`provider status ${response.status}`);
        const status = normaliseStatus(data?.status || data?.state);
        const responseHeaders = Object.fromEntries(response.headers.entries());
        if (job.status === 'completed') {
          const cost = normalizeMuapiCost({ response: data, headers: responseHeaders });
          if (cost.reliable && cost.amountUsdCents != null) {
            const costWrite = await callRpc('record_provider_cost_once', {
              p_reservation_id: null,
              p_generation_job_id: job.id,
              p_provider: 'muapi',
              p_provider_request_id: cost.providerRequestId,
              p_actual_cost_cents: cost.amountUsdCents,
              p_raw_response: data,
            });
            if (!costWrite.ok) throw new Error('provider cost could not be recorded');
            await updateRows(
              'generation_requests',
              { id: `eq.${job.id}` },
              { provider_cost_status: 'recorded' }
            );
          } else {
            summary.cost_pending = (summary.cost_pending || 0) + 1;
          }
          continue;
        }
        if (status === 'running') {
          summary.running += 1;
        } else if (status === 'completed') {
          await completeJob(job, data, responseHeaders);
          summary.completed += 1;
        } else {
          await failJob(job);
          summary.failed += 1;
        }
      } catch (error) {
        summary.errors += 1;
        console.error('generation reconciliation failed', job.id, error);
      }
    }

    await insertRows('admin_metric_events', {
      event_type: 'generation_reconciliation',
      status: summary.errors ? 'partial' : 'completed',
    });
    return Response.json({ status: summary.errors ? 'partial' : 'ok', ...summary });
  } catch (error) {
    console.error('reconciliation scheduler', error);
    return safeError('Reconciliation failed.', 500);
  }
}
