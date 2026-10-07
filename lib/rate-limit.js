// Per-instance sliding-window rate limiter. Credits already stop paid abuse;
// this protects the server, the database and the providers from bursts (a
// stuck client loop, a script, or a sudden wave of new users).

const buckets = new Map();
const MAX_KEYS = 50_000;

export function hit(key, { limit, windowMs }, now = Date.now()) {
  let times = buckets.get(key);
  if (!times) {
    if (buckets.size >= MAX_KEYS) buckets.delete(buckets.keys().next().value);
    times = [];
    buckets.set(key, times);
  }
  while (times.length && times[0] <= now - windowMs) times.shift();
  if (times.length >= limit) {
    return { allowed: false, retryAfter: Math.max(1, Math.ceil((times[0] + windowMs - now) / 1000)) };
  }
  times.push(now);
  return { allowed: true, retryAfter: 0 };
}

/** Returns a 429 Response when the key is over its limit, otherwise null. */
export function rateLimit(key, opts) {
  const result = hit(key, opts);
  if (result.allowed) return null;
  return Response.json(
    { error: 'You are going a little fast. Please wait a moment and try again.' },
    { status: 429, headers: { 'Retry-After': String(result.retryAfter) } }
  );
}

export function resetRateLimits() {
  buckets.clear();
}
