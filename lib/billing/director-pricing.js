// AI Director usage is paid for with credits (1 credit = 1 US cent).
// Prices sit well above worst-case model cost because output tokens are capped
// per call (see DIRECTOR_MAX_OUTPUT_TOKENS), so every call keeps a margin.

export const DIRECTOR_CREDIT_COSTS = Object.freeze({
  assist: 8, // one rewrite or first draft of a single field
  plan: 30, // a full production plan: scenes, characters, locations
});

export const DIRECTOR_MAX_OUTPUT_TOKENS = Object.freeze({ assist: 3000, plan: 9000 });

export const DIRECTOR_PRICING_POLICY = 'director-2026-10-02-v1';

export function directorCost(kind) {
  const env = kind === 'plan' ? process.env.DIRECTOR_PLAN_CREDITS : process.env.DIRECTOR_ASSIST_CREDITS;
  const override = Number.parseInt(env || '', 10);
  const base = DIRECTOR_CREDIT_COSTS[kind] ?? DIRECTOR_CREDIT_COSTS.assist;
  // An override may raise the price but never make the Director free.
  return Number.isInteger(override) && override >= 1 ? override : base;
}
