import { validateContinuity } from './continuity-validator';
import { continuityScore } from './continuity-score';

export function reviewContinuity(project) {
  const issues = validateContinuity({ bible: project.continuityBible, scenes: project.scenes, storyboard: project.storyboard, projectId: project.id });
  return { issues, ...continuityScore(issues), isDemo: true };
}
