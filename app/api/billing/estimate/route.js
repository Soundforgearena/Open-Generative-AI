import { guard, safeError, selectRows, selectOne } from '../../../../lib/cinexvideo-server';
import { estimateOperation } from '../../../../lib/billing/estimate-engine.js';
import {
  requireFreshMuapiCatalog,
  setMuapiCatalogSnapshot,
  snapshotFromModelCostRules,
} from '../../../../lib/providers/muapi-price-catalog.js';

/**
 * Produces a customer-facing credit estimate for an operation.
 *
 * The provider cost never comes from the request body: it is read from the
 * most recently cached MuAPI price snapshot and falls back to the active
 * server-side model_cost_rules when the process cache is cold, so a fresh
 * deploy does not 503 until the cron has warmed the catalog.
 */
export async function POST(request) {
  const { user, error } = await guard(request, { blockOnMaintenance: true });
  if (error) return error;

  try {
    const body = await request.json();
    const { operation, model, units = 1 } = body;
    if (!operation || !model) return safeError('Estimate request is incomplete.');

    let modelPrice;
    try {
      modelPrice = requireFreshMuapiCatalog().models?.[model];
    } catch {
      modelPrice = null;
    }

    if (!modelPrice) {
      const rules = await selectRows(
        'model_cost_rules',
        {
          model: `eq.${model}`,
          operation: `eq.${operation}`,
          active: 'eq.true',
          customer_visible: 'eq.true',
        },
        'model,operation,provider_cost_cents,max_duration_seconds,max_resolution,max_references'
      );
      const snapshot = setMuapiCatalogSnapshot(snapshotFromModelCostRules(rules));
      modelPrice = snapshot.models?.[model];
    }

    if (!modelPrice || !Number.isFinite(modelPrice.costCentsPerUnit)) {
      return safeError('That creative option is not available.', 409);
    }

    const wallet = await selectOne('credit_wallets', { user_id: `eq.${user.id}` }, 'balance');

    const estimate = estimateOperation({
      operation,
      model,
      muapiEstimateCents: modelPrice.costCentsPerUnit * units,
      units,
      availableCredits: wallet?.balance ?? 0,
    });

    return Response.json(estimate);
  } catch (err) {
    console.error('billing estimate', err);
    return safeError('Could not build an estimate. Please try again.', 500);
  }
}
