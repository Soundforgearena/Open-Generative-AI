import { guard, callRpc, selectOne, safeError } from '../../../../../../lib/cinexvideo-server';

/**
 * Cancels/releases an unused reservation, returning its credits to the wallet.
 *
 * Ownership is checked server-side before releasing: a user can only cancel
 * their own reservation, never one belonging to another account.
 */
export async function POST(request, { params }) {
  const { user, error } = await guard(request, { blockOnMaintenance: true });
  if (error) return error;

  try {
    const { id } = await params;
    const reservation = await selectOne(
      'credit_reservations',
      { id: `eq.${id}` },
      'id,user_id,status'
    );
    if (!reservation || reservation.user_id !== user.id) {
      return safeError('Reservation not found.', 404);
    }

    const result = await callRpc('release_reservation_v2', {
      p_reservation_id: id,
      p_reason: 'customer_cancelled',
    });

    if (!result.ok) {
      return safeError('Could not cancel this reservation.', 409);
    }

    return Response.json({ reservation: result.data });
  } catch (err) {
    console.error('billing reservation cancel', err);
    return safeError('Could not cancel this reservation.', 500);
  }
}
