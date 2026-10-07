export const SRE_POLICY = Object.freeze({
  maxAttemptsPerIncident: 3,
  cooldownMs: 15 * 60 * 1000,
  maxInvestigationMs: 5 * 60 * 1000,
  maxRepairMs: 5 * 60 * 1000,
  maxValidationMs: 20 * 60 * 1000,
  minimumConfidence: 0.8,
  maxChangedFiles: 12,
  maxChangedLines: 600,
  maxPullRequestsPerHour: 5,
  protectedPaths: [
    'app/api/admin/',
    'app/api/billing/',
    'app/api/partners/',
    'lib/admin/',
    'lib/stripe',
    'supabase/migrations/',
    'middleware.js',
    '.env',
    'Dockerfile',
    'package-lock.json',
  ],
  requiredChecks: ['lint', 'tests', 'build', 'preview-smoke', 'secret-scan'],
  neverAutomaticMerge: [
    'authentication', 'authorization', 'billing', 'payouts',
    'database-migration', 'infrastructure', 'secrets',
  ],
});

export function validateRepairProposal(proposal) {
  if (!proposal || !Array.isArray(proposal.files)) throw new Error('Invalid repair proposal');
  if (!proposal.branch || proposal.branch === 'main') throw new Error('Repairs must use a non-production branch');
  if (proposal.files.length > SRE_POLICY.maxChangedFiles) throw new Error('Repair changes too many files');
  if (proposal.linesChanged > SRE_POLICY.maxChangedLines) throw new Error('Repair changes too many lines');
  const protectedFile = proposal.files.find((file) => SRE_POLICY.protectedPaths.some((prefix) => file.startsWith(prefix)));
  return protectedFile
    ? { ...proposal, requiresHumanReview: true, reviewReason: `Protected path changed: ${protectedFile}` }
    : { ...proposal, requiresHumanReview: false };
}

export function canRetryIncident({ attempts, cooldownUntil, now = Date.now() }) {
  return attempts < SRE_POLICY.maxAttemptsPerIncident && now >= cooldownUntil;
}

export function shouldEscalate({ proposal, validation, attempts }) {
  return attempts >= SRE_POLICY.maxAttemptsPerIncident || !validation?.ok || proposal?.requiresHumanReview === true;
}
