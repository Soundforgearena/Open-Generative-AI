import { guard, callRpc, safeError } from '../../../../lib/cinexvideo-server';
import { MARGIN_POLICY } from '../../../../lib/billing/margin-policy.js';

/**
 * Confirms a credit reservation for an operation.
 *
 * The reservation is created atomically in the database (reserve_credits_v2):
 * it checks and debits the wallet balance in the same transaction, so two
 * concurrent requests can never both succeed against an insufficient
 * balance. Idempotent on the caller-supplied idempotency key.
 */
export async function POST(request) {
  const { user, error } = await guard(request, { blockOnMaintenance: true });
  if (error) return error;

  try {
    const body = await request.json();
    const {
      operation,
      estimated_credits: estimatedCredits,
      max_reservation_credits: maxReservationCredits,
      idempotency_key: idempotencyKey,
    } = body;

    if (
      !operation ||
      !Number.isInteger(estimatedCredits) ||
      estimatedCredits < 0 ||
      !Number.isInteger(maxReservationCredits) ||
      maxReservationCredits < estimatedCredits ||
      !idempotencyKey
    ) {
      return safeError('Reservation request is incomplete.');
    }

    const result = await callRpc('reserve_credits_v2', {
      p_user_id: user.id,
      p_operation: operation,
      p_estimated_credits: estimatedCredits,
      p_max_reservation_credits: maxReservationCredits,
      p_pricing_policy_version: MARGIN_POLICY.version,
      p_idempotency_key: idempotencyKey,
    });

    if (!result.ok) {
      const message = String(result.data?.message || '');
      if (message.includes('INSUFFICIENT_CREDITS')) {
        return safeError('You need more credits to continue.', 402);
      }
      return safeError('Could not reserve credits. Please try again.', 409);
    }

    return Response.json({ reservation: result.data });
  } catch (err) {
    console.error('billing reservations', err);
    return safeError('Could not reserve credits. Please try again.', 500);
  }
}
