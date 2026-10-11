import { createHash } from 'node:crypto';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

export function directorFingerprint(body) {
  return createHash('sha256').update(JSON.stringify(canonical(body))).digest('hex');
}

// A unique database row is the cross-process lock. Reservations alone are not
// locks: reserve_paid_credits_v1 can return an existing reservation.
export async function runDirectorOnce({ userId, key, body, store, run }) {
  if (typeof key !== 'string' || key.length < 1 || key.length > 200) {
    return Response.json({ error: 'Invalid request identifier.' }, { status: 400 });
  }
  const fingerprint = directorFingerprint(body);
  const filters = { user_id: `eq.${userId}`, idempotency_key: `eq.${key}` };
  const unavailable = () => Response.json(
    { error: 'The Director request could not be confirmed. Retry with the same request identifier; do not start another paid request.' },
    { status: 503 },
  );
  try {
    const claim = await store.insert({
      user_id: userId, idempotency_key: key, fingerprint, status: 'processing',
    });
    if (!claim.ok) {
      if (claim.data?.code !== '23505') return unavailable();
      const existing = await store.find(filters);
      if (!existing) return unavailable();
      if (existing.fingerprint !== fingerprint) {
        return Response.json({ error: 'This request identifier belongs to different input. Start a new request.', code: 'IDEMPOTENCY_KEY_CONFLICT' }, { status: 409 });
      }
      if (existing.status === 'completed') {
        return Response.json(existing.response_body, {
          status: existing.response_status,
          headers: { 'Idempotency-Replayed': 'true' },
        });
      }
      return Response.json({
        error: 'This Director request is still being processed or awaiting reconciliation. Retry the same request later.',
        code: 'REQUEST_IN_PROGRESS',
      }, { status: 409, headers: { 'Retry-After': '3' } });
    }
    const response = await run();
    const responseBody = await response.clone().json();
    const saved = await store.update(filters, {
      status: 'completed', response_status: response.status,
      response_body: responseBody, updated_at: new Date().toISOString(),
    });
    if (!saved.ok) return unavailable();
    return response;
  } catch {
    // A timeout/process restart is never permission to spend again.
    return unavailable();
  }
}
