export function settleReservation(reservation, actualCredits) {
  if (!reservation || reservation.status !== 'reserved') throw new Error('Reservation is not settleable.');
  if (!Number.isInteger(actualCredits) || actualCredits < 0) throw new Error('Actual credits must be a non-negative integer.');
  if (actualCredits > reservation.amount) throw new Error('Actual settlement exceeds the confirmed reservation.');
  return { ...reservation, settledCredits: actualCredits, releasedCredits: reservation.amount - actualCredits, status: 'settled' };
}

export function settlePartialBatch(reservation, completedCredits, failedCredits) { return settleReservation(reservation, completedCredits + failedCredits); }

export function releaseReservation(reservation, reason = 'provider_failed') {
  if (!reservation || reservation.status !== 'reserved') throw new Error('Reservation is not releasable.');
  return { ...reservation, settledCredits: 0, releasedCredits: reservation.amount, status: 'released', reason };
}
