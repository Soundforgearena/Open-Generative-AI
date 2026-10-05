// AI Director pricing: real OpenAI token cost + payment fees + a fixed margin.
//
// 1 credit is always worth exactly 1 US cent. Each request is reserved at its
// worst-case price, then settled at the price of the tokens actually used, so
// users pay for what they use and never more than the price shown up front.
//
// Rates: OpenAI Standard tier, short context, USD per 1M tokens
// (https://developers.openai.com/api/docs/pricing, checked 2026-10-02).
// Reasoning tokens are billed as output tokens and count toward max_output_tokens.

import { CUSTOMER_CREDIT_PACKS, CUSTOMER_SUBSCRIPTION_PLANS, CREDIT_USD_VALUE_CENTS } from './credit-catalog.js';
import { MARGIN_POLICY } from './margin-policy.js';
import { paymentFeeCents } from './payment-fee-model.js';

export const DIRECTOR_PRICING_POLICY = 'director-2026-10-02-v2';
export const OPENAI_RATES_CHECKED = '2026-10-02';

/** [input, cachedInput, output] USD per 1M tokens. Longest prefix wins. */
export const OPENAI_TOKEN_RATES = Object.freeze({
  'gpt-6-astra': [10, 1, 50],
  'gpt-6.1-sol': [2, 0.1, 10],
  'gpt-6-sol': [2, 0.2, 10],
  'gpt-6-luna': [0.1, 0.01, 0.5],
  'gpt-5.6-sol': [4, 0.4, 20],
  'gpt-5.6-terra': [2, 0.2, 12],
  'gpt-5.6-luna': [0.2, 0.02, 1.2],
  'gpt-5.5-pro': [30, 30, 180],
  'gpt-5.5': [5, 0.5, 30],
  'gpt-5.4-pro': [30, 30, 180],
  'gpt-5.4-mini': [0.75, 0.075, 4.5],
  'gpt-5.4-nano': [0.2, 0.02, 1.25],
  'gpt-5.4': [2.5, 0.25, 15],
  'gpt-5.2-pro': [21, 21, 168],
  'gpt-5.2': [1.75, 0.175, 14],
  'gpt-5.1': [1.25, 0.125, 10],
  'gpt-5-pro': [15, 15, 120],
  'gpt-5-mini': [0.25, 0.025, 2],
  'gpt-5-nano': [0.05, 0.005, 0.4],
  'gpt-5': [1.25, 0.125, 10],
  'gpt-4.1-mini': [0.4, 0.1, 1.6],
  'gpt-4.1-nano': [0.1, 0.025, 0.4],
  'gpt-4.1': [2, 0.5, 8],
  'gpt-4o-mini': [0.15, 0.075, 0.6],
  'gpt-4o': [2.5, 1.25, 10],
  'o4-mini': [1.1, 0.275, 4.4],
  'o3-mini': [1.1, 0.55, 4.4],
  'o3': [2, 0.5, 8],
});

// An unrecognised model is priced like the most expensive non-pro model, so a
// configuration change can never make the Director run at a loss.
const UNKNOWN_MODEL_RATES = [10, 10, 50];

/** Hard token budgets per request. Inputs are truncated server-side to fit. */
export const DIRECTOR_TOKEN_BUDGET = Object.freeze({
  assist: { input: 3500, output: 2000 },
  plan: { input: 2500, output: 6000 },
});

/** Contribution margin kept on every Director request (67.5%, the platform target). */
export const DIRECTOR_MARGIN_BPS = MARGIN_POLICY.targetContributionMarginBps;
export const DIRECTOR_MIN_CREDITS = 1;

export function ratesFor(model) {
  const id = String(model || '').toLowerCase();
  const key = Object.keys(OPENAI_TOKEN_RATES)
    .filter((k) => id === k || id.startsWith(`${k}-`))
    .sort((a, b) => b.length - a.length)[0];
  return { known: Boolean(key), rates: key ? OPENAI_TOKEN_RATES[key] : UNKNOWN_MODEL_RATES };
}

export function isReasoningModel(model) {
  return /^(gpt-5|gpt-6|o\d)/i.test(String(model || ''));
}

/**
 * Lowest net revenue we receive per purchased credit after card fees, across
 * every pack (bonus-heavy packs earn least per credit). Pricing uses this
 * worst case, so the margin holds whichever pack the user bought.
 */
export const NET_CENTS_PER_CREDIT = Math.min(
  ...[...CUSTOMER_CREDIT_PACKS, ...CUSTOMER_SUBSCRIPTION_PLANS].map((pack) => (pack.priceCents - paymentFeeCents(pack.priceCents, MARGIN_POLICY.paymentFeeModel)) / pack.creditsGranted)
);

/** Exact OpenAI cost in US cents for a token usage record. */
export function tokenCostCents(model, { inputTokens = 0, cachedTokens = 0, outputTokens = 0 }) {
  const [inRate, cachedRate, outRate] = ratesFor(model).rates;
  const cached = Math.min(Math.max(0, cachedTokens), Math.max(0, inputTokens));
  const usd = ((inputTokens - cached) * inRate + cached * cachedRate + Math.max(0, outputTokens) * outRate) / 1_000_000;
  return usd * 100;
}

/** Credits to charge for a given OpenAI cost: covers card fees and keeps the margin. */
export function creditsForCost(costCents, { atCost = false } = {}) {
  // At cost (super admins): recover the provider cost and card fees, no margin.
  const keep = atCost ? 1 : (10000 - DIRECTOR_MARGIN_BPS) / 10000;
  const credits = Math.ceil((costCents / CREDIT_USD_VALUE_CENTS) / (NET_CENTS_PER_CREDIT * keep) - 1e-9);
  return Math.max(DIRECTOR_MIN_CREDITS, credits);
}

/** Price ceiling shown to the user and reserved before the model runs. */
export function maxDirectorCredits(kind, model, opts = {}) {
  const budget = DIRECTOR_TOKEN_BUDGET[kind] || DIRECTOR_TOKEN_BUDGET.assist;
  return creditsForCost(tokenCostCents(model, { inputTokens: budget.input, outputTokens: budget.output }), opts);
}

/** Price actually settled, from the usage OpenAI reports. Never above the ceiling. */
export function settledDirectorCredits(kind, model, usage, opts = {}) {
  const max = maxDirectorCredits(kind, model, opts);
  if (!usage || !Number.isFinite(Number(usage.input_tokens)) || !Number.isFinite(Number(usage.output_tokens))) return max;
  const cost = tokenCostCents(model, {
    inputTokens: Number(usage.input_tokens),
    cachedTokens: Number(usage.input_tokens_details?.cached_tokens) || 0,
    outputTokens: Number(usage.output_tokens),
  });
  return Math.min(max, creditsForCost(cost, opts));
}

/** Rough typical price for UI copy ("usually about N credits"). */
export function typicalDirectorCredits(kind, model, opts = {}) {
  const typical = kind === 'plan' ? { inputTokens: 900, outputTokens: 2600 } : { inputTokens: 1400, outputTokens: 700 };
  return creditsForCost(tokenCostCents(model, typical), opts);
}

/** Rough chars-per-token used to keep prompts inside the input budget. */
export const CHARS_PER_TOKEN = 3.5;
