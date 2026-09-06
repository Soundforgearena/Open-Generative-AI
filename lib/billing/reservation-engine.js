export function reserveCredits(wallet, amount, idempotencyKey) {
  if (!Number.isInteger(amount) || amount < 0) throw new Error('Reservation amount must be a non-negative integer.');
  if (wallet.reservations?.[idempotencyKey]) return wallet.reservations[idempotencyKey];
  const available = wallet.availableCredits - amount;
  if (available < 0) throw new Error('Insufficient available credits.');
  return { idempotencyKey, amount, availableCredits: available, status: 'reserved' };
}

export function releaseReservation(reservation, reason = 'provider_failed') { return { ...reservation, releasedCredits: reservation.amount, status: 'released', reason }; }
