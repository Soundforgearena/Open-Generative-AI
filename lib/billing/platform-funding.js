// Platform funding: super admins use the platform's own OpenAI and MUAPI
// accounts, so their usage is paid from platform funds instead of credits.
// They can still buy credits like anyone else (for example to test checkout).

/** Daily safety cap on platform-funded usage per super admin, in US cents of customer-equivalent value. */
export function platformDailyCapCents() {
  const value = Number.parseInt(process.env.PLATFORM_FUNDED_DAILY_CAP_CENTS || '', 10);
  return Number.isInteger(value) && value > 0 ? value : 10000; // $100/day default
}

export function platformFundingEnabled() {
  return process.env.PLATFORM_FUND_SUPER_ADMINS !== 'false';
}

/** Super admins are platform-funded unless the feature is switched off. */
export function isPlatformFunded({ superAdmin } = {}) {
  return Boolean(superAdmin) && platformFundingEnabled();
}

/** Remaining platform-funded allowance today, given today's recorded usage rows. */
export function remainingPlatformAllowanceCents(rows = []) {
  const used = rows.reduce((sum, row) => sum + Math.max(0, Number(row.credits_equivalent) || 0), 0);
  return Math.max(0, platformDailyCapCents() - used);
}

export function startOfUtcDay(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}
