import {
  guard,
  safeError,
} from '../../../../lib/cinexvideo-server';
import { estimateOperation } from '../../../../lib/billing/estimate-engine.js';
import { requireFreshMuapiCatalog } from '../../../../lib/providers/muapi-price-catalog.js';
import { selectOne } from '../../../../lib/cinexvideo-server';

/**
 * Produces a customer-facing credit estimate for an operation.
 *
 * The provider cost never comes from the request body: it is read from the
 * most recently verified MuAPI price catalog snapshot. If no fresh snapshot
 * exists, the estimate is refused rather than guessed, so a stale or
 * fabricated cost can never under-price a generation.
 */
export async function POST(request) {
  const { user, error } = await guard(request, { blockOnMaintenance: true });
  if (error) return error;

  try {
    const body = await request.json();
    const { operation, model, units = 1 } = body;
    if (!operation || !model) return safeError('Estimate request is incomplete.');

    let catalog;
    try {
      catalog = requireFreshMuapiCatalog();
    } catch {
      return safeError('Pricing is temporarily unavailable. Please try again shortly.', 503);
    }

    const modelPrice = catalog.models?.[model];
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
