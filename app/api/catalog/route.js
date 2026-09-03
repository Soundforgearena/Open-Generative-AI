import { guard, selectRows, safeError } from '../../../lib/cinexvideo-server';

/**
 * Customer-facing creative options.
 *
 * Only customer_label, model key and operation leave the server. Provider name,
 * provider cost, overhead, payment fees and the target margin are stripped —
 * customers must never be able to infer the internal pricing model.
 */
export async function GET(request) {
  const { error } = await guard(request);
  if (error) return error;
  try {
    const rows = await selectRows(
      'model_cost_rules',
      { active: 'eq.true', customer_visible: 'eq.true', order: 'operation.asc' },
      'model,operation,customer_label,max_duration_seconds,max_resolution,max_references'
    );
    return Response.json({
      options: rows.map((row) => ({
        model: row.model,
        operation: row.operation,
        label: row.customer_label || row.operation,
        max_duration_seconds: row.max_duration_seconds,
        max_resolution: row.max_resolution,
        max_references: row.max_references,
      })),
    });
  } catch (err) {
    console.error('catalog route', err);
    return safeError('Creative options are temporarily unavailable.', 500);
  }
}
