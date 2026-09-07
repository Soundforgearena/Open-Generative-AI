const cache = { value: null, expiresAt: 0 };

export function setMuapiCatalogSnapshot(snapshot, ttlMs = 15 * 60 * 1000) { cache.value = { ...snapshot, retrievedAt: new Date().toISOString() }; cache.expiresAt = Date.now() + ttlMs; return cache.value; }
export function getMuapiCatalogSnapshot() { return cache.value && cache.expiresAt > Date.now() ? cache.value : null; }
export function requireFreshMuapiCatalog() { const snapshot = getMuapiCatalogSnapshot(); if (!snapshot) throw new Error('A recent verified MuAPI catalog snapshot is required.'); return snapshot; }
