export const STRIPE_RECONCILE_EVERY_MS = 15 * 60 * 1000;
export const STRIPE_RECONCILE_TIMEOUT_MS = 20000;
export const HEARTBEAT_RETENTION_DAYS = 7;
const MAX_DIAGNOSTIC_LENGTH = 300;

export function sanitizeDiagnostic(value, secrets = []) {
  let text = typeof value === 'string' ? value : value == null ? '' : String(value);
  for (const secret of secrets) {
    if (secret && secret.length >= 4) text = text.split(secret).join('[redacted]');
  }
  text = text
    .replace(/Bearer\s+[A-Za-z0-9._~+\/=-]+/gi, '******')
    .replace(/\b(?:sk|rk|pk|whsec)_(?:live|test)?_?[A-Za-z0-9]{8,}/g, '[redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, '[redacted]')
    .replace(/(["']?(?:authorization|api[_-]?key|secret|token|password)["']?\s*[:=]\s*)(["']?)[^"',\s}]+/gi, '$1$2[redacted]')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > MAX_DIAGNOSTIC_LENGTH ? `${text.slice(0, MAX_DIAGNOSTIC_LENGTH)}...` : text;
}

async function readDiagnostics(response, secrets) {
  let raw = '';
  try {
    raw = await response.text();
  } catch {
    raw = '';
  }
  let parsed = null;
  let malformed = false;
  try {
    parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') malformed = true;
  } catch {
    malformed = true;
  }
  const nested = parsed && typeof parsed === 'object' ? parsed.error ?? parsed.message ?? raw : raw;
  const body = sanitizeDiagnostic(typeof nested === 'string' ? nested : JSON.stringify(nested), secrets);
  return { malformed, body };
}

/**
 * Work that rides on the every-minute scheduler call. Never throws, so it
 * cannot fail generation reconciliation. A failed Stripe attempt is recorded
 * as an event so the 15 minute cadence applies to failures too (no retry storm).
 */
export async function runChainedMaintenance(request, summary, deps) {
  const {
    selectOne,
    insertRows,
    deleteRows,
    fetchImpl = fetch,
    now = () => Date.now(),
    secrets = [process.env.CRON_SECRET],
    logger = console,
  } = deps;
  const authorization = request.headers.get('authorization') || '';
  const allSecrets = [...secrets, authorization.replace(/^Bearer\s+/i, '')];

  let due = false;
  try {
    const last = await selectOne(
      'admin_metric_events',
      { event_type: 'eq.stripe_reconciliation', order: 'created_at.desc' },
      'created_at'
    );
    const lastAt = last ? new Date(last.created_at).getTime() : NaN;
    due = !last || Number.isNaN(lastAt) || now() - lastAt >= STRIPE_RECONCILE_EVERY_MS;
  } catch (error) {
    logger.error('chained stripe reconcile', sanitizeDiagnostic(error?.message || error, allSecrets));
  }

  if (due) {
    let failure = null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), STRIPE_RECONCILE_TIMEOUT_MS);
    try {
      const response = await fetchImpl(new URL('/api/admin/cron/stripe-reconcile', request.url), {
        method: 'POST',
        headers: { authorization },
        cache: 'no-store',
        signal: controller.signal,
      });
      summary.stripe_reconcile = response.status;
      if (!response.ok || response.status === 203) {
        const { body } = await readDiagnostics(response, allSecrets);
        failure = { status: response.status, body };
      } else {
        const { malformed, body } = await readDiagnostics(response, allSecrets);
        if (malformed) failure = { status: response.status, body: `malformed response: ${body}` };
      }
    } catch (error) {
      const timedOut = controller.signal.aborted || error?.name === 'AbortError';
      summary.stripe_reconcile = timedOut ? 'timeout' : 'error';
      failure = {
        status: summary.stripe_reconcile,
        body: sanitizeDiagnostic(error?.message || error, allSecrets),
      };
    } finally {
      clearTimeout(timer);
    }

    if (failure) {
      summary.stripe_reconcile_error = { status: failure.status, body: failure.body };
      logger.error('chained stripe reconcile', failure);
      try {
        await insertRows('admin_metric_events', { event_type: 'stripe_reconciliation', status: 'failed' });
      } catch (error) {
        logger.error('chained stripe reconcile backoff', sanitizeDiagnostic(error?.message || error, allSecrets));
      }
    }
  }

  try {
    const cutoff = new Date(now() - HEARTBEAT_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    await deleteRows('admin_metric_events', {
      event_type: 'in.(generation_reconciliation,stripe_reconciliation)',
      created_at: `lt.${cutoff}`,
    });
  } catch (error) {
    logger.error('heartbeat prune', sanitizeDiagnostic(error?.message || error, allSecrets));
  }
}
