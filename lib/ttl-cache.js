// Tiny in-memory TTL cache with in-flight de-duplication. Used for values
// read on almost every request (who is signed in, admin flags, site
// settings) so a traffic spike doesn't multiply database and auth calls.

export function createTtlCache({ ttlMs, max = 20_000 }) {
  const store = new Map();
  return {
    async get(key, load, ttl = ttlMs) {
      const now = Date.now();
      const hit = store.get(key);
      if (hit && hit.expires > now) return hit.promise;
      const promise = Promise.resolve().then(load);
      if (store.size >= max) store.delete(store.keys().next().value);
      store.set(key, { promise, expires: now + ttl });
      // Never cache failures.
      promise.catch(() => store.delete(key));
      return promise;
    },
    delete(key) { store.delete(key); },
    clear() { store.clear(); },
  };
}
