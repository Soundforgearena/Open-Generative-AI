// When MUAPI's upstream model is at capacity ("Request Has Reached API
// Concurrent Limit, Please Try Later"), the job is resubmitted with the same
// input a few times, with growing waits, instead of failing at once.
//
// The job keeps its original provider_request_id (what the Studio polls);
// the live attempt's id lives in output.busy_retry.current_request_id. The
// customer is charged once, only when a take is delivered.

export const BUSY_RE = /concurrent limit|try (again )?later|too many requests|rate limit|server (is )?busy|overloaded|at capacity|queue is full/i;
export const MAX_BUSY_RETRIES = 4;
const WAITS_MS = [30_000, 60_000, 90_000, 120_000];

export function busyWaitMs(attempt) {
  return WAITS_MS[Math.min(Math.max(0, attempt), WAITS_MS.length - 1)];
}

/** The provider id to check now (the latest resubmission, if any). */
export function currentRequestId(job) {
  return job?.output?.busy_retry?.current_request_id || job?.provider_request_id || null;
}

/** The provider's failure reason as text. */
export function providerReason(data) {
  const raw = data?.error ?? data?.detail ?? data?.message ?? null;
  if (raw == null) return '';
  return (typeof raw === 'string' ? raw : JSON.stringify(raw)).slice(0, 400);
}

export function isBusyFailure(data, httpStatus = 200) {
  return httpStatus === 429 || BUSY_RE.test(providerReason(data));
}

/** What to save on the job at submission so it can be resubmitted. */
export function retryState({ endpoint, input }) {
  return { busy_retry: { endpoint, input, attempts: 0, next_at: null, current_request_id: null } };
}

/**
 * Decide what to do with a failed provider attempt.
 * Returns { action: 'not_busy' } (fail normally), { action: 'exhausted' }
 * (fail as busy), or { action: 'waiting' | 'resubmitted', attempt }.
 */
export async function handleBusyFailure({ job, data, httpStatus, base, apiKey, updateRows, fetchImpl = fetch, now = Date.now() }) {
  const state = job?.output?.busy_retry;
  if (!isBusyFailure(data, httpStatus)) return { action: 'not_busy' };
  if (!state?.input || !state?.endpoint) return { action: 'exhausted' };
  const attempts = Number(state.attempts) || 0;
  if (attempts >= MAX_BUSY_RETRIES) return { action: 'exhausted' };

  // Wait first, so the provider has time to free capacity.
  if (!state.next_at) {
    await updateRows('generation_requests', { id: `eq.${job.id}` }, {
      output: { busy_retry: { ...state, next_at: new Date(now + busyWaitMs(attempts)).toISOString() } },
    });
    return { action: 'waiting', attempt: attempts + 1 };
  }
  if (Date.parse(state.next_at) > now) return { action: 'waiting', attempt: attempts + 1 };

  // Claim this attempt so two open tabs can never resubmit twice.
  const claimed = await updateRows(
    'generation_requests',
    { id: `eq.${job.id}`, status: 'eq.running', 'output->busy_retry->>attempts': `eq.${attempts}` },
    { output: { busy_retry: { ...state, attempts: attempts + 1, next_at: null } } }
  );
  if (!claimed.ok || !Array.isArray(claimed.data) || claimed.data.length === 0) {
    return { action: 'waiting', attempt: attempts + 1 };
  }

  let newId = null;
  try {
    const res = await fetchImpl(`${base}/api/v1/${state.endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify(state.input),
    });
    const body = await res.json().catch(() => null);
    if (res.ok) newId = body?.request_id || body?.id || null;
  } catch {
    newId = null;
  }
  await updateRows('generation_requests', { id: `eq.${job.id}` }, {
    output: {
      busy_retry: {
        ...state,
        attempts: attempts + 1,
        current_request_id: newId || state.current_request_id || null,
        // Not accepted: wait again before the next try.
        next_at: newId ? null : new Date(now + busyWaitMs(attempts + 1)).toISOString(),
      },
    },
  });
  return { action: newId ? 'resubmitted' : 'waiting', attempt: attempts + 1 };
}
