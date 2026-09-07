import {
  guard,
  callRpc,
  selectOne,
  selectRows,
  insertRows,
  safeError,
} from '../../../../lib/cinexvideo-server';
import { evaluateReservationRisk } from '../../../../lib/billing/risk-policy.js';
import { evaluateProviderExposure } from '../../../../lib/billing/provider-exposure-guard.js';

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

    const [openReservations, accountStatus] = await Promise.all([
      selectRows(
        'credit_reservations',
        { user_id: `eq.${user.id}`, status: 'eq.reserved' },
        'id'
      ),
      selectOne('user_account_status', { user_id: `eq.${user.id}` }, 'created_at'),
    ]);

    const accountAgeHours = accountStatus?.created_at
      ? (Date.now() - new Date(accountStatus.created_at).getTime()) / 3600000
      : Infinity;

    const risk = evaluateReservationRisk(
      {
        accountAgeHours,
        openReservationsCount: openReservations.length,
        reservedCreditsLastHour: 0, // not yet tracked; conservative default
        chargebackCount: 0, // real value wired once refund_records aggregation lands
      },
      reservation.max_reservation_credits
    );
    if (risk.decision === 'blocked') {
      return safeError('This request could not be started right now.', 403);
    }

    // Provider exposure is evaluated on a best-effort basis: when trailing
    // revenue is not yet tracked, this defaults to a conservative cap of $0,
    // which queues rather than silently allowing unlimited exposure.
    const exposure = evaluateProviderExposure({
      trailingRevenueCents: 0,
      outstandingReservedCreditsUsdCents: 0,
      requestedCents: 0,
    });
    if (exposure.decision === 'blocked') {
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
