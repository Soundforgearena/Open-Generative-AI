const MUSIC_VIDEO_DEFAULTS = {
  treatment: '',
  style_bible: '',
  beat_map: '',
  storyboard_notes: '',
  continuity_metadata: '',
  approval_locked: false,
  approved_at: null,
};

const EPISODE_DEFAULTS = {
  premise: '',
  treatment: '',
  screenplay: '',
  cast_world: '',
  references: '',
  runtime_minutes: 24,
  scene_breakdown: '',
  continuity_bible: '',
  shot_plan: '',
  greenlit: false,
  greenlit_at: null,
};

export function defaultDirectorWorkflow(lane) {
  return lane === 'music_video' ? { ...MUSIC_VIDEO_DEFAULTS } : { ...EPISODE_DEFAULTS };
}

export function normalizeDirectorWorkflow(lane, directorPlan) {
  const source = directorPlan?.workflow || {};
  const defaults = defaultDirectorWorkflow(lane);
  const merged = { ...defaults, ...source };
  if (lane === 'episode') {
    const runtime = Number(merged.runtime_minutes);
    merged.runtime_minutes = Number.isFinite(runtime) ? Math.min(Math.max(Math.round(runtime), 1), 240) : 24;
  }
  return merged;
}

export function buildDirectorPlanPatch({ lane, workflow, existingPlan }) {
  const normalized = normalizeDirectorWorkflow(lane, { workflow });
  return {
    ...(existingPlan && typeof existingPlan === 'object' ? existingPlan : {}),
    lane,
    workflow: normalized,
  };
}

export function generationGate({ lane, workflow, selectedSceneId, videoOption, configMessage = '' }) {
  if (!videoOption) {
    return {
      allowed: false,
      reason: configMessage || 'Generation is disabled: no configured video model is available for this account.',
    };
  }
  if (!selectedSceneId) {
    return { allowed: false, reason: 'Select a scene before requesting generation.' };
  }
  const approved = lane === 'music_video' ? Boolean(workflow?.approval_locked) : Boolean(workflow?.greenlit);
  if (!approved) {
    return {
      allowed: false,
      reason: lane === 'music_video'
        ? 'Approve and lock this music-video plan before generation can start.'
        : 'Greenlight this episode plan before generation can start.',
    };
  }
  return { allowed: true, reason: '' };
}
