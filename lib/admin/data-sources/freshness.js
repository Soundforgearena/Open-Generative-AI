export const FRESHNESS_THRESHOLDS = { stripe: 60 * 60 * 1000, muapi: 60 * 60 * 1000, supabase: 15 * 60 * 1000, jobs: 15 * 60 * 1000 };

export function sourceStatus({ records = [], lastSuccessfulSyncAt = null, sourceConfigured = false, source = 'unknown' }) {
  if (!sourceConfigured) return { status: 'unavailable', sourceSystems: [source], asOf: null, lastSuccessfulSyncAt, freshnessThreshold: FRESHNESS_THRESHOLDS[source] || null, reason: 'Source is not configured or connected.' };
  if (!records.length) return { status: 'no_data', sourceSystems: [source], asOf: null, lastSuccessfulSyncAt, freshnessThreshold: FRESHNESS_THRESHOLDS[source] || null, reason: 'No verified records exist for this period.' };
  const stale = lastSuccessfulSyncAt && Date.now() - new Date(lastSuccessfulSyncAt).getTime() > (FRESHNESS_THRESHOLDS[source] || 0);
  return { status: stale ? 'stale' : 'verified', sourceSystems: [source], asOf: new Date().toISOString(), lastSuccessfulSyncAt, freshnessThreshold: FRESHNESS_THRESHOLDS[source] || null, reason: stale ? 'The latest successful sync is outside the freshness threshold.' : null };
}
