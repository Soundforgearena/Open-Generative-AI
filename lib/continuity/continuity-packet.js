export function compileContinuityPacket({ bible, previousShot, nextShot, project, shotPrompt = '' }) {
  return {
    projectStyleLock: bible?.projectVisualStyle || {},
    characterIdentityLocks: bible?.characters || [],
    activeWardrobeLook: nextShot?.wardrobeLookId || null,
    activePropState: nextShot?.continuity?.entryState?.propStates || [],
    activeLocation: nextShot?.continuity?.entryState?.locationState || {},
    previousExitState: previousShot?.continuity?.exitState || null,
    expectedEntryState: nextShot?.continuity?.entryState || null,
    cameraConstraints: { screenDirection: nextShot?.continuity?.entryState?.screenDirection, cameraAxis: nextShot?.continuity?.entryState?.cameraAxis },
    lyricRequirements: { lyricRange: nextShot?.lyricRange || null, lipSyncMode: nextShot?.lipSyncMode || 'none' },
    approvedReferenceIds: nextShot?.continuity?.requiredReferences || [],
    negativeConstraints: bible?.projectVisualStyle?.negativeConstraints || bible?.globalRules || [],
    shotPrompt,
    transitionGuidance: nextShot?.continuity?.handoffNotes || [],
    projectId: project?.id || null,
  };
}
