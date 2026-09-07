export function analyzeFailures(attempts = []) {
  const count = attempts.length;
  const completed = attempts.filter((item) => item.result === 'success').length;
  const providerChargedFailures = attempts.filter((item) => item.result === 'failed_provider_charge').length;
  const retries = attempts.filter((item) => item.attemptNumber > 1).length;
  const absorbedCostCents = attempts.reduce((sum, item) => sum + Math.max(0, Number(item.platformAbsorbedCostCents || 0)), 0);
  return { attempts: count, firstAttemptSuccessRate: count ? completed / count : 0, providerChargedFailureRate: count ? providerChargedFailures / count : 0, retryRate: count ? retries / count : 0, absorbedCostCents, averageProviderCostPerCompletedShotCents: completed ? attempts.reduce((sum, item) => sum + Number(item.providerCostCents || 0), 0) / completed : 0 };
}
