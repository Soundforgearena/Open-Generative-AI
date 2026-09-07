export function continuityScore(issues = []) {
  const blocking = issues.filter((issue) => issue.severity === 'blocking').length;
  const warnings = issues.filter((issue) => issue.severity === 'warning').length;
  const score = Math.max(0, 100 - blocking * 30 - warnings * 8);
  return { score, readiness: blocking ? 'Blocked' : warnings ? 'Needs review' : 'Ready', blocking, warnings };
}
