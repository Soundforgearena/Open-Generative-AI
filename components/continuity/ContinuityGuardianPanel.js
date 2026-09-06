'use client';

import { useMemo } from 'react';
import { reviewContinuity } from '@/lib/continuity/continuity-demo-review';
import ContinuityWarnings from './ContinuityWarnings';

export default function ContinuityGuardianPanel({ project, onFix }) {
  const review = useMemo(() => reviewContinuity(project || {}), [project]);
  return <aside className="cinex-continuity-guardian" aria-labelledby="continuity-guardian-title"><div className="cinex-continuity-heading"><div><p className="cinex-shot-plan-eyebrow">Continuity Guardian</p><h2 id="continuity-guardian-title">{review.readiness}</h2></div><span className="cinex-status-badge">{review.score}/100</span></div><p className="cinex-form-optional">Demo review checks declared states and timing. It is not vision-model QA.</p><ContinuityWarnings issues={review.issues} /><div className="cinex-dashboard-actions"><button type="button" className="cinex-auth-secondary" onClick={onFix}>Fix with AI Director</button><button type="button" className="cinex-auth-secondary" disabled={review.blocking > 0}>Generate anyway</button></div></aside>;
}
