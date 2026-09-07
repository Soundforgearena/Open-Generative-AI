import { selectRows, callRpc, getSetting } from '../../../lib/cinexvideo-server';

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
    p_provider_cost_cents: rule.provider_cost_cents,
    p_duration_seconds: durationSeconds,
    p_resolution: null,
    p_reference_count: 0,
  });
  const row = Array.isArray(quote.data) ? quote.data[0] : quote.data;
  if (!quote.ok || !row?.approved) return null;
  const credits = Number(row.credits);
  return Number.isFinite(credits) ? credits : null;
}

export async function GET() {
  try {
    const [packs, plans, rules, signup] = await Promise.all([
      selectRows('credit_packs', { active: 'eq.true', order: 'sort_order.asc' }, 'code,name,credits,price_cents,blurb'),
      selectRows('customer_visible_plans', {}, 'code,name,monthly_price_cents,included_credits,overage_price_cents'),
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

    return Response.json({
      packs: packs.map((pack) => ({
        ...pack,
        credits_per_dollar: Math.round((pack.credits / (pack.price_cents / 100)) * 10) / 10,
        cents_per_credit: Math.round((pack.price_cents / pack.credits) * 1000) / 1000,
      })),
      plans,
      actions,
      best_value_code: cheapest?.pack?.code || null,
      free_actions: ['Exports and watermarking', 'Script, scene and shot planning', 'Reference uploads and storage'],
      signup_credits: Number(signup?.signup_credits) || 0,
    });
  } catch (err) {
    console.error('pricing route', err);
    return Response.json({ error: 'Pricing is temporarily unavailable.' }, { status: 503 });
  }
}
