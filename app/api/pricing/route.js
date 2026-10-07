import { maxDirectorCredits, typicalDirectorCredits } from '../../../lib/billing/director-pricing';
import { selectRows, callRpc, getSetting } from '../../../lib/cinexvideo-server';
import { providerCostCents } from '../../../lib/billing/provider-pricing';
import { createTtlCache } from '../../../lib/ttl-cache';

const DIRECTOR_MODEL = process.env.OPENAI_DIRECTOR_MODEL || 'gpt-5';

/**
 * Public pricing.
 *
 * Credit costs are produced by the same quote_generation routine that prices a
 * real generation, so a published figure can never drift from what is actually
 * charged. Provider identity, provider cost, overhead and margin are computed
 * server-side and deliberately excluded from the response.
 */

const VIDEO_SAMPLE_SECONDS = [5, 8, 10];

/**
 * Only operations that can actually be requested through /api/generate are
 * published. Export and watermark processing runs through /api/exports, which
 * debits nothing, so listing it here would invent a charge that never happens.
 */
const CHARGED_OPERATIONS = new Set(['video', 'image', 'edit']);

function unitFor(operation) {
  if (operation === 'video') return 'per scene';
  if (operation === 'image') return 'per image';
  if (operation === 'edit') return 'per edit';
  return 'per run';
}

async function quoteCredits(rule, durationSeconds) {
  const quote = await callRpc('quote_generation', {
    p_provider: rule.provider,
    p_model: rule.model,
    p_operation: rule.operation,
    // Same real per-second cost the generate route uses (default 720p).
    p_provider_cost_cents: providerCostCents({ model: rule.model, operation: rule.operation, durationSeconds, resolution: '720p', ruleCostCents: rule.provider_cost_cents }),
    p_duration_seconds: durationSeconds,
    p_resolution: null,
    p_reference_count: 0,
  });
  const row = Array.isArray(quote.data) ? quote.data[0] : quote.data;
  if (!quote.ok || !row?.approved) return null;
  const credits = Number(row.credits);
  return Number.isFinite(credits) ? credits : null;
}

async function buildPricing() {
  {
    const [packs, plans, rules, signup] = await Promise.all([
      selectRows('credit_packs', { active: 'eq.true', order: 'sort_order.asc' }, 'code,name,credits,price_cents,blurb'),
      selectRows('customer_visible_plans', { monthly_price_cents: 'gt.0', order: 'sort_order.asc' }, 'code,name,monthly_price_cents,included_credits,blurb'),
      selectRows(
        'model_cost_rules',
        { active: 'eq.true', customer_visible: 'eq.true', order: 'operation.asc' },
        'provider,model,operation,provider_cost_cents,customer_label,max_duration_seconds,max_references'
      ),
      getSetting('signup_credits'),
    ]);

    const actions = [];
    for (const rule of rules) {
      if (!CHARGED_OPERATIONS.has(rule.operation)) continue;
      if (rule.operation === 'video') {
        const cap = Number(rule.max_duration_seconds) || 10;
        const durations = VIDEO_SAMPLE_SECONDS.filter((seconds) => seconds <= cap);
        const tiers = [];
        for (const seconds of durations) {
          const credits = await quoteCredits(rule, seconds);
          if (credits !== null) tiers.push({ duration_seconds: seconds, credits });
        }
        if (tiers.length) {
          actions.push({
            label: rule.customer_label || rule.operation,
            operation: rule.operation,
            unit: unitFor(rule.operation),
            max_duration_seconds: rule.max_duration_seconds,
            max_references: rule.max_references,
            tiers,
          });
        }
      } else {
        const credits = await quoteCredits(rule, 1);
        if (credits !== null) {
          actions.push({
            label: rule.customer_label || rule.operation,
            operation: rule.operation,
            unit: unitFor(rule.operation),
            max_duration_seconds: rule.max_duration_seconds,
            max_references: rule.max_references,
            tiers: [{ duration_seconds: null, credits }],
          });
        }
      }
    }

    // A single published conversion so a credit figure can be read in money.
    const cheapest = packs.reduce(
      (best, pack) => {
        const centsPerCredit = pack.price_cents / pack.credits;
        return !best || centsPerCredit < best.centsPerCredit ? { pack, centsPerCredit } : best;
      },
      null
    );

    return {
      packs: packs.map((pack) => ({
        ...pack,
        credits_per_dollar: Math.round((pack.credits / (pack.price_cents / 100)) * 10) / 10,
        cents_per_credit: Math.round((pack.price_cents / pack.credits) * 1000) / 1000,
      })),
      plans,
      actions,
      best_value_code: cheapest?.pack?.code || null,
      director: {
        paid_credits_only: true,
        assist: { label: 'AI Director writing help', max_credits: maxDirectorCredits('assist', DIRECTOR_MODEL), typical_credits: typicalDirectorCredits('assist', DIRECTOR_MODEL) },
        plan: { label: 'AI Director full production plan', max_credits: maxDirectorCredits('plan', DIRECTOR_MODEL), typical_credits: typicalDirectorCredits('plan', DIRECTOR_MODEL) },
      },
      free_actions: ['Exports and watermarking', 'Writing and editing scenes and shots yourself', 'Reference uploads and storage', 'Readiness checks'],
      signup_credits: Number(signup?.signup_credits) || 0,
    };
  }
}

// Public and identical for everyone: cache it so a traffic spike on the
// pricing page costs one database read every 30 seconds, not one per visitor.
const pricingCache = createTtlCache({ ttlMs: 30_000, max: 1 });

export async function GET() {
  try {
    const body = await pricingCache.get('pricing', buildPricing);
    return Response.json(body, { headers: { 'Cache-Control': 'public, max-age=30, s-maxage=60, stale-while-revalidate=300' } });
  } catch (err) {
    console.error('pricing route', err);
    return Response.json({ error: 'Pricing is temporarily unavailable.' }, { status: 503 });
  }
}
