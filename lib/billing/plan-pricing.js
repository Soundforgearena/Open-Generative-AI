// Subscriber pricing: monthly plans pay a lower markup on every generation,
// so a subscription buys noticeably more video than the same money in packs.
// Every price still clears the plan's margin after provider cost, overhead
// and card fees, so no generation ever loses money.

/** Target margin (%) by plan. Packs / no plan use the rule's own margin (65%). */
export const PLAN_MARGIN_PERCENT = Object.freeze({
  creator: 55,
  studio: 55,
  pro: 50,
});

export const PLAN_PRICING_POLICY = 'plan-margin-2026-10-16-v1';

const ACTIVE = new Set(['active', 'trialing']);

/** The plan code that earns subscriber pricing right now, or null. */
export function activePlanCode(subscriptions = [], now = Date.now()) {
  const live = (subscriptions || []).filter((s) => ACTIVE.has(String(s?.status))
    && (!s.current_period_end || Date.parse(s.current_period_end) > now)
    && PLAN_MARGIN_PERCENT[s.plan_code] !== undefined);
  if (!live.length) return null;
  // Best (lowest) margin wins if someone somehow has two plans.
  return live.sort((a, b) => PLAN_MARGIN_PERCENT[a.plan_code] - PLAN_MARGIN_PERCENT[b.plan_code])[0].plan_code;
}

/**
 * Credits for a job at a given margin, using the same formula as the
 * database quote (quote_generation), so a plan price is the list price with
 * only the margin changed. 1 credit = 1 US cent.
 */
export function creditsAtMargin(rule, providerCostCents, marginPercent) {
  const cost = Math.max(0, Number(providerCostCents) || 0);
  const fixed = Number(rule?.fixed_overhead_cents) || 0;
  const variable = Number(rule?.variable_overhead_percent) || 0;
  const feeFixed = Number(rule?.payment_fee_fixed_cents) || 0;
  const feePercent = Number(rule?.payment_fee_percent) || 0;
  const minimum = Number(rule?.minimum_customer_price_cents) || 0;
  const margin = Math.max(0, Math.min(90, Number(marginPercent) || 0));
  const totalCost = cost + fixed + (cost * variable) / 100;
  const divisor = Math.max(0.01, 1 - margin / 100 - feePercent / 100);
  const price = Math.max(minimum, Math.round(((totalCost + feeFixed) / divisor) * 100) / 100);
  return Math.max(1, Math.ceil(price - 1e-9));
}

/**
 * Subscriber price for a job, never above the list price and never below
 * the plan margin. Returns null when no plan discount applies.
 */
export function planCredits({ rule, providerCostCents, listCredits, planCode }) {
  const margin = PLAN_MARGIN_PERCENT[planCode];
  if (margin === undefined) return null;
  const credits = creditsAtMargin(rule, providerCostCents, margin);
  return Math.min(Number(listCredits) || credits, credits);
}

/** Look up the caller's plan (server only). */
export async function planCodeFor(userId) {
  if (!userId) return null;
  const { selectRows } = await import('../cinexvideo-server.js');
  const rows = await selectRows(
    'user_subscriptions',
    { user_id: `eq.${userId}`, status: 'in.(active,trialing)' },
    'plan_code,status,current_period_end'
  ).catch(() => []);
  return activePlanCode(rows);
}
