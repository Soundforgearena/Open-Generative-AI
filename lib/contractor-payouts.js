export const CONTRACTOR_MAX_PAYOUT_CENTS = 500_000;
export const CONTRACTOR_POOL_BPS = 5_000;

export const CONTRACTOR_UNIT_ALLOCATION = Object.freeze([
  { key: 'beatkit', email: 'beatkitbuilder@gmail.com', displayName: 'BeatKitBuilder', units: 36 },
  { key: 'kingbeat', email: 'kingbeatexclusives@gmail.com', displayName: 'King Beat Exclusives', units: 5 },
  { key: 'ally', email: 'allygreen82@gmail.com', displayName: 'Ally Green', units: 5 },
  { key: 'officialamaziah', email: 'OfficialAmaziahMusic@gmail.com', displayName: 'Official Amaziah Music', units: 5 },
  { key: 'isaackwalusimbi', email: 'Isaackwalusimbi@gmail.com', displayName: 'Isaac K. Walusimbi', units: 4 },
  { key: 'isaiahwalusimbi', email: 'isaiahwalusimbi@gmail.com', displayName: 'Isaiah Walusimbi', units: 4 },
]);

export const TOTAL_CONTRACTOR_UNITS = CONTRACTOR_UNIT_ALLOCATION.reduce(
  (total, contractor) => total + contractor.units,
  0
);

export function payoutPeriodBounds(period) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
    throw new Error('Payout period must use YYYY-MM format.');
  }
  const start = `${period}-01T00:00:00.000Z`;
  const [year, month] = period.split('-').map(Number);
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  return { period, start, end: `${String(nextYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}-01T00:00:00.000Z` };
}

export function calculateMonthlyContractorPayouts({ totalRevenueCents, contractors = CONTRACTOR_UNIT_ALLOCATION }) {
  if (!Number.isInteger(totalRevenueCents) || totalRevenueCents < 0) {
    throw new Error('totalRevenueCents must be a non-negative integer.');
  }
  const totalUnits = contractors.reduce((total, contractor) => total + contractor.units, 0);
  if (!Number.isInteger(totalUnits) || totalUnits <= 0) throw new Error('Contractor units must total more than zero.');

  const contractorPoolCents = Math.floor((totalRevenueCents * CONTRACTOR_POOL_BPS) / 10000);
  let totalCappedToPlatformCents = 0;
  const payouts = contractors.map((contractor) => {
    const rawShareCents = Math.round((contractorPoolCents * contractor.units) / totalUnits);
    const cappedShareCents = Math.min(rawShareCents, CONTRACTOR_MAX_PAYOUT_CENTS);
    const excessToPlatformCents = rawShareCents - cappedShareCents;
    totalCappedToPlatformCents += excessToPlatformCents;
    return {
      ...contractor,
      rawShareCents,
      cappedShareCents,
      excessToPlatformCents,
    };
  });

  return {
    totalRevenueCents,
    contractorPoolCents,
    totalCappedToPlatformCents,
    payouts,
  };
}
