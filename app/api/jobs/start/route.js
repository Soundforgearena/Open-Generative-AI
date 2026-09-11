import {
  guard,
  selectOne,
  selectRows,
  insertRows,
  safeError,
} from '../../../../lib/cinexvideo-server';
import { evaluateReservationRisk } from '../../../../lib/billing/risk-policy.js';
import { evaluateProviderExposure } from '../../../../lib/billing/provider-exposure-guard.js';
import {
  loadRuntimeSafetySignals,
  requestedCreditsToUsdCents,
} from '../../../../lib/billing/runtime-safety-signals.js';

/**
 * Starts a generation job against an already-confirmed credit reservation.
 *
 * This never creates its own reservation: the client must call
 * POST /api/billing/reservations first. That separation means a job can only
 * ever be started once the wallet debit has already happened atomically, so
 * this route only needs to check ownership/risk/exposure, never money.
 */
export async function POST(request) {
  const { user, error } = await guard(request, { blockOnMaintenance: true });
  if (error) return error;

  try {
    const body = await request.json();
    const {
      reservation_id: reservationId,
      model,
      operation,
      input,
      scene_id: sceneId = null,
      project_id: projectId = null,
    } = body;

    if (!reservationId || !model || !operation || !input) {
      return safeError('Job request is incomplete.');
    }

    const reservation = await selectOne(
      'credit_reservations',
      { id: `eq.${reservationId}` },
      'id,user_id,status,max_reservation_credits,operation'
    );
    if (!reservation || reservation.user_id !== user.id) {
      return safeError('Reservation not found.', 404);
    }
    if (reservation.status !== 'reserved') {
      return safeError('This reservation is no longer available.', 409);
    }
    if (reservation.operation !== operation) {
      return safeError('Reservation does not match this operation.', 409);
    }

    const runtimeSignals = await loadRuntimeSafetySignals({
      userId: user.id,
      requestedCredits: reservation.max_reservation_credits,
      selectOneFn: selectOne,
      selectRowsFn: selectRows,
    });
    const risk = evaluateReservationRisk(
      {
        ...runtimeSignals.risk,
        openReservationsCount: Math.max(0, runtimeSignals.risk.openReservationsCount - 1),
        reservedCreditsLastHour: Math.max(
          0,
          runtimeSignals.risk.reservedCreditsLastHour - Number(reservation.max_reservation_credits || 0)
        ),
      },
      reservation.max_reservation_credits
    );
    if (risk.decision === 'blocked') {
      return safeError('This request could not be started right now.', 403);
    }

    const exposure = evaluateProviderExposure({
      ...runtimeSignals.exposure,
      requestedCents: 0,
      outstandingReservedCreditsUsdCents: Math.max(
        0,
        runtimeSignals.exposure.outstandingReservedCreditsUsdCents
          - requestedCreditsToUsdCents(reservation.max_reservation_credits)
      ),
    });
    if (exposure.decision !== 'allowed') {
      return safeError('This creative option is temporarily at capacity.', 503);
    }

    const { data: job } = await insertRows('generation_requests', {
      user_id: user.id,
      project_id: projectId,
      scene_id: sceneId,
      provider: 'muapi',
      model,
      operation,
      reservation_reference: reservation.id,
      credits_reserved: reservation.max_reservation_credits,
      status: 'queued',
    });

    return Response.json({ job: Array.isArray(job) ? job[0] : job });
  } catch (err) {
    console.error('jobs start', err);
    return safeError('Could not start this job. Please try again.', 500);
  }
}
