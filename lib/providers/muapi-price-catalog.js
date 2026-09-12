const cache = { value: null, expiresAt: 0 };

export function setMuapiCatalogSnapshot(snapshot, ttlMs = 15 * 60 * 1000) { cache.value = { ...snapshot, retrievedAt: new Date().toISOString() }; cache.expiresAt = Date.now() + ttlMs; return cache.value; }
export function getMuapiCatalogSnapshot() { return cache.value && cache.expiresAt > Date.now() ? cache.value : null; }
export function requireFreshMuapiCatalog() { const snapshot = getMuapiCatalogSnapshot(); if (!snapshot) throw new Error('A recent verified MuAPI catalog snapshot is required.'); return snapshot; }
export function snapshotFromModelCostRules(rows = []) {
  return {
    source: 'model_cost_rules',
    models: rows.reduce((models, row) => {
      if (row?.model && Number.isFinite(Number(row.provider_cost_cents))) {
        models[row.model] = {
          operation: row.operation || null,
          costCentsPerUnit: Math.max(0, Math.round(Number(row.provider_cost_cents))),
          max_duration_seconds: row.max_duration_seconds ?? null,
          max_resolution: row.max_resolution ?? null,
          max_references: row.max_references ?? null,
        };
      }
      return models;
    }, {}),
  };
}
