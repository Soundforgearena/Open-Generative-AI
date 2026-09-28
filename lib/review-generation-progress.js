const TERMINAL_SCENE_STATUSES = new Set(['completed', 'failed', 'released']);
const ACTIVE_SCENE_STATUSES = new Set(['queued', 'running']);

function normalizeSceneStatus(status, { creditsReturned = null } = {}) {
  const value = String(status || '').toLowerCase();
  if (value === 'completed') return 'completed';
  if (value === 'failed' && creditsReturned !== null && creditsReturned !== undefined) return 'released';
  if (value === 'failed') return 'failed';
  if (value === 'running') return 'running';
  if (value === 'queued') return 'queued';
  return 'pending';
}

function summarizeSceneProgress(sceneProgress = []) {
  const totals = {
    total: sceneProgress.length,
    pending: 0,
    queued: 0,
    running: 0,
    completed: 0,
    failed: 0,
    released: 0,
  };
  for (const scene of sceneProgress) {
    const status = normalizeSceneStatus(scene?.status);
    totals[status] += 1;
  }
  totals.started = totals.total - totals.pending;
  totals.active = totals.queued + totals.running;
  totals.terminal = totals.completed + totals.failed + totals.released;
  return totals;
}

function calculateProgressPercentage(summary) {
  const safeSummary = summary?.total ? summary : summarizeSceneProgress([]);
  if (!safeSummary.total) return 0;
  const weightedProgress = (
    safeSummary.queued * 0.2
    + safeSummary.running * 0.6
    + safeSummary.completed
    + safeSummary.failed
    + safeSummary.released
  ) / safeSummary.total;
  return Math.max(0, Math.min(100, Math.round(weightedProgress * 100)));
}

function hasActiveGenerationJobs(summary) {
  return Number(summary?.active || 0) > 0;
}

function hasAnyGenerationJobsInFlight(summary, submitting = false) {
  return Boolean(submitting) || Number(summary?.active || 0) > 0 || Number(summary?.pending || 0) > 0;
}

module.exports = {
  ACTIVE_SCENE_STATUSES,
  TERMINAL_SCENE_STATUSES,
  calculateProgressPercentage,
  hasActiveGenerationJobs,
  hasAnyGenerationJobsInFlight,
  normalizeSceneStatus,
  summarizeSceneProgress,
};
