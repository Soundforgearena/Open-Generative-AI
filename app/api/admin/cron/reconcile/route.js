import {
  callRpc,
  deleteRows,
  insertRows,
  requireSecret,
  safeError,
  selectOne,
  selectRows,
  updateRows,
} from '../../../../../lib/cinexvideo-server';
import { normalizeMuapiCost } from '../../../../../lib/providers/muapi-cost-adapter.js';
import { settledGenerationCredits } from '../../../../../lib/billing/at-cost.js';

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
    'id,status,max_reservation_credits,pricing_policy_version'
  );
}

async function completeJob(job, data, headers = {}) {
  const output = data?.output || data?.result || null;
  const outputUrl = firstUrl(output);
  const platformJob = job.funding_source === 'platform';
  const reservation = platformJob ? null : await reservationFor(job);
  const cost = normalizeMuapiCost({ response: data, headers });

  if (platformJob) {
    // Platform-funded (super admin): no credits to settle.
  } else if (reservation?.status === 'reserved') {
    // Customers pay the price they confirmed; at-cost (super admin) jobs pay
          // the provider's reported cost plus card fees, capped at the confirmed price.
          const actualCredits = settledGenerationCredits(reservation, cost);
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
    if (platformJob) {
      await updateRows('platform_funded_usage', { generation_job_id: `eq.${job.id}` }, { estimated_cost_cents: cost.amountUsdCents });
    }
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

  if (!platformJob) {
    const revenue = await callRpc('settle_generation_revenue', {
      p_generation_request_id: job.id,
    });
    if (!revenue.ok) throw new Error('generation revenue could not be settled');
  }

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
  const platformJob = job.funding_source === 'platform';
  const reservation = platformJob ? null : await reservationFor(job);
  if (platformJob) {
    // Nothing to refund: platform-funded jobs never debited credits.
  } else if (reservation?.status === 'reserved') {
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

const STRIPE_RECONCILE_EVERY_MS = 15 * 60 * 1000;
const HEARTBEAT_RETENTION_DAYS = 7;

/**
 * Work that rides on the every-minute scheduler call, so no extra cron
 * needs to be set up on the host:
 * - Stripe fee reconciliation every 15 minutes (read-only on Stripe).
 * - Pruning scheduler heartbeat rows older than 7 days, so the events table
 *   cannot grow without limit and eat database storage.
 * Failures here never fail the generation reconciliation itself.
 */
async function chainedMaintenance(request, summary) {
  try {
    const last = await selectOne(
      'admin_metric_events',
      { event_type: 'eq.stripe_reconciliation', order: 'created_at.desc' },
      'created_at'
    );
    const due = !last || Date.now() - new Date(last.created_at).getTime() >= STRIPE_RECONCILE_EVERY_MS;
    if (due) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20000);
      try {
        const response = await fetch(new URL('/api/admin/cron/stripe-reconcile', request.url), {
          method: 'POST',
          headers: { authorization: request.headers.get('authorization') || '' },
          cache: 'no-store',
          signal: controller.signal,
        });
        summary.stripe_reconcile = response.status;
      } finally {
        clearTimeout(timer);
      }
    }
  } catch (error) {
    summary.stripe_reconcile = 'error';
    console.error('chained stripe reconcile', error?.message || error);
  }

  try {
    const cutoff = new Date(Date.now() - HEARTBEAT_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    await deleteRows('admin_metric_events', {
      event_type: 'in.(generation_reconciliation,stripe_reconciliation)',
      created_at: `lt.${cutoff}`,
    });
  } catch (error) {
    console.error('heartbeat prune', error?.message || error);
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
          { headers: { 'x-api-key': apiKey }, cache: 'no-store' }
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
    await chainedMaintenance(request, summary);
    return Response.json({ status: summary.errors ? 'partial' : 'ok', ...summary });
  } catch (error) {
    console.error('reconciliation scheduler', error);
    return safeError('Reconciliation failed.', 500);
  }
}
