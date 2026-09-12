import { CREDIT_USD_VALUE_CENTS } from './credit-catalog.js';

const HOUR_MS = 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * HOUR_MS;

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function reservationCredits(row) {
  return Math.max(0, Math.round(toNumber(row?.max_reservation_credits ?? row?.credits)));
}

export function reservedCreditsLastHour(rows = [], now = Date.now()) {
  return rows.reduce((total, row) => {
    const createdAt = row?.created_at ? new Date(row.created_at).getTime() : 0;
    if (!createdAt || now - createdAt > HOUR_MS) return total;
    return total + reservationCredits(row);
  }, 0);
}

export function countChargebacks(rows = []) {
  const disputes = new Set();
  let fallbackCount = 0;

  for (const row of rows) {
    const kind = String(row?.kind || '');
    if (!kind.startsWith('dispute_')) continue;
    const disputeId = String(row?.stripe_dispute_id || '').trim();
    if (disputeId) {
      disputes.add(disputeId);
      continue;
    }
    if (kind === 'dispute_created') fallbackCount += 1;
  }

  return disputes.size + fallbackCount;
}

export function trailingRevenueCents(rows = []) {
  return rows.reduce(
    (total, row) => total + Math.max(0, Math.round(toNumber(row?.net_cents ?? row?.gross_cents))),
    0
  );
}

export function outstandingReservedCreditsUsdCents(rows = []) {
  return rows.reduce((total, row) => total + reservationCredits(row) * CREDIT_USD_VALUE_CENTS, 0);
}

export function requestedCreditsToUsdCents(requestedCredits) {
  return Math.max(0, Math.round(toNumber(requestedCredits))) * CREDIT_USD_VALUE_CENTS;
}

export async function loadRuntimeSafetySignals({
  userId,
  requestedCredits,
  selectOneFn,
  selectRowsFn,
  now = Date.now(),
}) {
  const lastHourIso = new Date(now - HOUR_MS).toISOString();
  const trailingRevenueSinceIso = new Date(now - THIRTY_DAYS_MS).toISOString();

  const [accountStatus, openReservations, recentReservations, chargebackRows, revenueRows, outstandingRows] =
    await Promise.all([
      selectOneFn('user_account_status', { user_id: `eq.${userId}` }, 'created_at'),
      selectRowsFn(
        'credit_reservations',
        { user_id: `eq.${userId}`, status: 'eq.reserved' },
        'id,max_reservation_credits,credits'
      ),
      selectRowsFn(
        'credit_reservations',
        { user_id: `eq.${userId}`, created_at: `gte.${lastHourIso}` },
        'created_at,max_reservation_credits,credits'
      ),
      selectRowsFn(
        'refund_records',
        { user_id: `eq.${userId}`, kind: 'in.(dispute_created,dispute_closed)' },
        'kind,stripe_dispute_id'
      ),
      selectRowsFn(
        'revenue_events',
        { created_at: `gte.${trailingRevenueSinceIso}` },
        'net_cents,gross_cents'
      ),
      selectRowsFn(
        'credit_reservations',
        { status: 'eq.reserved' },
        'max_reservation_credits,credits'
      ),
    ]);

  const accountAgeHours = accountStatus?.created_at
    ? (now - new Date(accountStatus.created_at).getTime()) / HOUR_MS
    : Infinity;

  return {
    risk: {
      accountAgeHours,
      openReservationsCount: openReservations.length,
      reservedCreditsLastHour: reservedCreditsLastHour(recentReservations, now),
      chargebackCount: countChargebacks(chargebackRows),
    },
    exposure: {
      trailingRevenueCents: trailingRevenueCents(revenueRows),
      outstandingReservedCreditsUsdCents: outstandingReservedCreditsUsdCents(outstandingRows),
      requestedCents: requestedCreditsToUsdCents(requestedCredits),
    },
  };
}
