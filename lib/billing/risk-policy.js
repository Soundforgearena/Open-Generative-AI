// Deterministic, server-only risk checks applied before a reservation is
// allowed. No network calls; callers supply the account/user signals.

export const RISK_THRESHOLDS = Object.freeze({
  maxOpenReservationsPerUser: 5,
  maxReservationCreditsPerHour: 20000,
  newAccountAgeHoursForLimitedSpend: 24,
  newAccountMaxReservationCredits: 1500,
  chargebackBlockThreshold: 1,
});

/**
 * @param {Object} account
 * @param {number} account.accountAgeHours
 * @param {number} account.openReservationsCount
 * @param {number} account.reservedCreditsLastHour
 * @param {number} account.chargebackCount
 * @param {number} requestedCredits
 */
export function evaluateReservationRisk(account, requestedCredits) {
  const flags = [];

  if ((account.chargebackCount || 0) >= RISK_THRESHOLDS.chargebackBlockThreshold) {
    flags.push('CHARGEBACK_ON_FILE');
  }
  if ((account.openReservationsCount || 0) >= RISK_THRESHOLDS.maxOpenReservationsPerUser) {
    flags.push('TOO_MANY_OPEN_RESERVATIONS');
  }
  if (
    (account.reservedCreditsLastHour || 0) + requestedCredits >
    RISK_THRESHOLDS.maxReservationCreditsPerHour
  ) {
    flags.push('HOURLY_RESERVATION_VELOCITY_EXCEEDED');
  }
  if (
    (account.accountAgeHours ?? Infinity) < RISK_THRESHOLDS.newAccountAgeHoursForLimitedSpend &&
    requestedCredits > RISK_THRESHOLDS.newAccountMaxReservationCredits
  ) {
    flags.push('NEW_ACCOUNT_SPEND_LIMIT_EXCEEDED');
  }

  return {
    decision: flags.length > 0 ? 'blocked' : 'allowed',
    flags,
  };
}
