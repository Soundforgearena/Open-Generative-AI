function issue(severity, category, message, extra = {}) { return { id: `${category}-${extra.sceneId || extra.shotId || 'project'}-${message.slice(0, 12)}`, severity, category, message, suggestedFix: extra.suggestedFix || 'Review the affected state and add an intentional transition.', canOverride: severity !== 'blocking', overrideReasonRequired: severity !== 'note', ...extra }; }

function compare(previous, current, key, category, label, issues, context) {
  if (previous && current && previous[key] && current[key] && previous[key] !== current[key] && !context.allowedChanges?.includes(key)) issues.push(issue('warning', category, `${label} changes from “${previous[key]}” to “${current[key]}” without an intentional transition.`, context));
}

export function validateContinuity({ bible, scenes = [], storyboard = [], projectId = 'project' }) {
  const issues = [];
  const items = storyboard.length ? storyboard : scenes;
  items.forEach((item, index) => {
    const continuity = item.continuity || {};
    const entry = continuity.entryState || {};
    const previous = items[index - 1]?.continuity?.exitState || null;
    const context = { projectId, sceneId: item.id, shotId: item.id, allowedChanges: continuity.allowedChanges };
    if (index && previous) {
      compare(previous, entry, 'locationState', 'Location', 'Location', issues, context);
      compare(previous, entry, 'weather', 'Weather', 'Weather', issues, context);
      compare(previous, entry, 'timeOfDay', 'Time', 'Time of day', issues, context);
      compare(previous, entry, 'lighting', 'Lighting', 'Lighting', issues, context);
      compare(previous, entry, 'screenDirection', 'Screen direction', 'Screen direction', issues, context);
      compare(previous, entry, 'cameraAxis', 'Camera axis', 'Camera axis', issues, context);
      compare(previous, entry, 'emotionalState', 'Emotional state', 'Emotional state', issues, context);
    }
    (continuity.characterStates || []).forEach((character) => {
      const lock = bible?.characters?.find((candidate) => candidate.id === character.characterId);
      if (!lock?.identityLock) issues.push(issue('warning', 'Identity', `${character.name || 'A recurring character'} has no identity lock.`, context));
    });
    if (item.type === 'performance' && item.lipSyncMode === 'eligible' && item.lyricConfirmationState !== 'confirmed') issues.push(issue('blocking', 'Lyrics/lip sync', 'Lip-sync is planned before lyrics are confirmed.', context));
    if (item.lipSyncMode === 'blocked') issues.push(issue('warning', 'Lyrics/lip sync', 'Lip-sync is unavailable until lyrics are reviewed and confirmed.', context));
    if (item.startSeconds !== undefined && item.endSeconds <= item.startSeconds) issues.push(issue('blocking', 'Timeline', 'Shot end must be after shot start.', context));
    if (index && item.startSeconds < items[index - 1].endSeconds) issues.push(issue('warning', 'Timeline', 'This shot overlaps the previous shot.', context));
    if (item.continuity?.requiredReferences?.length && !item.continuity.requiredReferences.every(Boolean)) issues.push(issue('warning', 'References', 'A required reference is missing.', context));
  });
  const style = bible?.projectVisualStyle;
  if (!style?.aspectRatio) issues.push(issue('note', 'Visual style', 'Set an aspect ratio in the project style lock.', { projectId }));
  return issues;
}
