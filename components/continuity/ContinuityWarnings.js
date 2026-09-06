'use client';

export default function ContinuityWarnings({ issues = [] }) {
  if (!issues.length) return <p className="cinex-continuity-clear" role="status">Continuity Guardian found no current warnings.</p>;
  return <ul className="cinex-continuity-issues" aria-live="polite">{issues.map((issue) => <li key={issue.id} className={`severity-${issue.severity}`}><strong>{issue.severity}</strong><span>{issue.category}: {issue.message}</span>{issue.suggestedFix && <small>{issue.suggestedFix}</small>}</li>)}</ul>;
}
