import { safeError, selectRows } from '../../../../../lib/cinexvideo-server';
import {
  setMuapiCatalogSnapshot,
  snapshotFromModelCostRules,
} from '../../../../../lib/providers/muapi-price-catalog.js';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  const expected = process.env.CRON_SECRET;
  const provided = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!expected || !provided || provided !== expected) return safeError('Cron authorization required.', 401);

  try {
    const rules = await selectRows(
      'model_cost_rules',
      { active: 'eq.true', customer_visible: 'eq.true' },
      'model,operation,provider_cost_cents,max_duration_seconds,max_resolution,max_references'
    );
    const snapshot = setMuapiCatalogSnapshot(snapshotFromModelCostRules(rules));
    return Response.json({
      status: 'ok',
      source: snapshot.source,
      retrieved_at: snapshot.retrievedAt,
      models: Object.keys(snapshot.models || {}).length,
    });
  } catch (error) {
    console.error('muapi catalog cron', error);
    return safeError('MuAPI catalog refresh failed.', 500);
  }
}
