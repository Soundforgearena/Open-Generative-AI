const IMAGE_EXT_RE = /\.(avif|bmp|gif|jpe?g|png|svg|webp)(\?.*)?$/i;
const VIDEO_EXT_RE = /\.(m3u8|m4v|mov|mp4|ogv|webm)(\?.*)?$/i;

export const LANE_LABELS = Object.freeze({
  music_video: 'Music Video Director',
  episode: 'Episode Director',
});

export const SCENE_GENERATION_FIELDS = Object.freeze([
  'title',
  'purpose',
  'prompt',
  'shot_direction',
  'duration_seconds',
  'continuity_locked',
  'audio_sync',
]);

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function stringValue(value, maxLength = 5000) {
  return typeof value === 'string' ? value.slice(0, maxLength) : '';
}

function normalizedLane(lane) {
  return lane === 'music_video' ? 'music_video' : 'episode';
}

function gateFieldForLane(lane) {
  return normalizedLane(lane) === 'music_video' ? 'approval_locked' : 'greenlit';
}

function hasCompletedPreview(version) {
  if (!version || version.status !== 'completed') return false;
  return Boolean(safePreviewUrl(version.thumbnail_url) || safePreviewUrl(version.output_url));
}

export function safePreviewUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return url.toString();
  } catch {
    return '';
  }
}

export function mediaTypeFor(url) {
  if (!url) return '';
  if (IMAGE_EXT_RE.test(url)) return 'image';
  if (VIDEO_EXT_RE.test(url)) return 'video';
  return '';
}

export function normalizeDirectorWorkflow(lane, directorPlan) {
  const plan = objectValue(directorPlan);
  const workflow = objectValue(plan.workflow);
  return {
    lane: normalizedLane(lane || workflow.lane),
    approval_locked: Boolean(workflow.approval_locked),
    greenlit: Boolean(workflow.greenlit),
    approved_at: workflow.approved_at || null,
    invalidated_at: workflow.invalidated_at || null,
    updated_at: workflow.updated_at || null,
  };
}

export function buildDirectorPlanPatch({
  lane,
  workflow,
  existingPlan,
  projectMeta = {},
  now = new Date().toISOString(),
}) {
  const currentPlan = objectValue(existingPlan);
  const currentVisualIdentity = objectValue(currentPlan.visual_identity);
  const nextVisualIdentity = objectValue(projectMeta.visual_identity);
  return {
    ...currentPlan,
    creative_title:
      stringValue(projectMeta.title, 200).trim() ||
      stringValue(currentPlan.creative_title, 200).trim() ||
      'Untitled project',
    logline:
      typeof projectMeta.logline === 'string'
        ? stringValue(projectMeta.logline)
        : stringValue(currentPlan.logline),
    visual_identity: {
      ...currentVisualIdentity,
      ...nextVisualIdentity,
    },
    workflow: {
      ...normalizeDirectorWorkflow(lane, currentPlan),
      ...objectValue(workflow),
      lane: normalizedLane(lane),
      updated_at: now,
    },
  };
}

export function approveDirectorWorkflow({
  lane,
  directorPlan,
  workflow,
  now = new Date().toISOString(),
}) {
  const nextWorkflow = {
    ...normalizeDirectorWorkflow(lane, workflow ? { workflow } : directorPlan),
    approved_at: now,
    invalidated_at: null,
    updated_at: now,
  };
  nextWorkflow[gateFieldForLane(lane)] = true;
  return nextWorkflow;
}

export function invalidateDirectorWorkflow({
  lane,
  directorPlan,
  workflow,
  now = new Date().toISOString(),
}) {
  const nextWorkflow = {
    ...normalizeDirectorWorkflow(lane, workflow ? { workflow } : directorPlan),
    updated_at: now,
  };
  const gateField = gateFieldForLane(lane);
  const invalidated = Boolean(nextWorkflow[gateField]);
  if (invalidated) {
    nextWorkflow[gateField] = false;
    nextWorkflow.invalidated_at = now;
  }
  return { workflow: nextWorkflow, invalidated };
}

export function generationGate({ lane, workflow, hasScene }) {
  if (!hasScene) {
    return { allowed: false, reason: 'Select a scene to estimate or generate.' };
  }
  const currentWorkflow = normalizeDirectorWorkflow(lane, workflow ? { workflow } : null);
  if (normalizedLane(lane) === 'music_video' && !currentWorkflow.approval_locked) {
    return { allowed: false, reason: 'Approve and lock this music-video plan before generation.' };
  }
  if (normalizedLane(lane) === 'episode' && !currentWorkflow.greenlit) {
    return { allowed: false, reason: 'Greenlight this episode plan before generation.' };
  }
  return { allowed: true, reason: 'Ready for estimate and paid confirmation.' };
}

export function scenePatchTouchesGeneration(scene, patch) {
  return SCENE_GENERATION_FIELDS.some((field) => {
    if (!Object.hasOwn(patch, field)) return false;
    const currentValue = scene?.[field];
    const nextValue = patch[field];
    if (field === 'duration_seconds') return Number(currentValue || 0) !== Number(nextValue || 0);
    if (field === 'continuity_locked') return Boolean(currentValue) !== Boolean(nextValue);
    return String(currentValue || '') !== String(nextValue || '');
  });
}

export function selectPreferredSceneVersion(versions = []) {
  const ordered = [...versions].sort((left, right) => Number(right.version || 0) - Number(left.version || 0));
  const newestCompletedWithPreview = ordered.find(hasCompletedPreview);
  if (newestCompletedWithPreview) return newestCompletedWithPreview;
  return ordered.find((version) => version.approved && hasCompletedPreview(version)) || ordered[0] || null;
}

export function mapSceneForWorkspace(scene) {
  const versions = [...(scene?.versions || [])]
    .sort((left, right) => Number(right.version || 0) - Number(left.version || 0))
    .map((version) => {
      const thumbnailUrl = safePreviewUrl(version.thumbnail_url || '');
      const outputUrl = safePreviewUrl(version.output_url || '');
      return {
        ...version,
        preview_thumbnail_url: thumbnailUrl,
        preview_output_url: outputUrl,
        preview_url: thumbnailUrl || outputUrl,
        preview_media_type: mediaTypeFor(outputUrl),
      };
    });
  const preferredVersion = selectPreferredSceneVersion(versions);
  return {
    id: scene.id,
    title: stringValue(scene.title, 200),
    purpose: stringValue(scene.purpose),
    prompt: stringValue(scene.prompt),
    shot_direction: stringValue(scene.shot_direction),
    audio_sync: stringValue(scene.audio_sync),
    audio_sync_supported: Object.hasOwn(scene || {}, 'audio_sync'),
    duration_seconds: Number(scene.duration_seconds || 8),
    continuity_locked: Boolean(scene.continuity_locked),
    status: scene.status || 'draft',
    position: Number(scene.position || 1),
    active_version: Number(scene.active_version || 0),
    preview_url: preferredVersion?.preview_url || '',
    preview_thumbnail_url: preferredVersion?.preview_thumbnail_url || '',
    preview_output_url: preferredVersion?.preview_output_url || '',
    preview_media_type: preferredVersion?.preview_media_type || '',
    versions,
  };
}

export function mapProjectForWorkspace(result, { fallbackLane = 'episode' } = {}) {
  const project = objectValue(result?.project || result);
  const lane = normalizedLane(project.lane || fallbackLane);
  const directorPlan = project.director_plan || result?.director_plan || null;
  const scenes = (result?.scenes || []).map(mapSceneForWorkspace);
  return {
    id: project.id,
    lane,
    title: stringValue(project.title, 200) || 'Untitled project',
    logline: stringValue(project.logline),
    status: stringValue(project.status, 100) || 'draft',
    visual_identity: {
      style: stringValue(project.visual_identity?.style, 200) || 'Cinematic',
      aspect_ratio: stringValue(project.visual_identity?.aspect_ratio, 50) || '16:9',
      lighting: stringValue(project.visual_identity?.lighting, 500),
      camera_language: stringValue(project.visual_identity?.camera_language, 500),
      palette: Array.isArray(project.visual_identity?.palette)
        ? project.visual_identity.palette.filter((value) => typeof value === 'string').slice(0, 6)
        : [],
    },
    director_plan: directorPlan,
    workflow: normalizeDirectorWorkflow(lane, directorPlan),
    scenes,
    assets: Array.isArray(result?.assets) ? result.assets : [],
  };
}

export function buildSceneGenerationPayload({ project, scene, option }) {
  if (!project?.id || !scene?.id || !option?.model) return null;
  const duration = Math.min(
    Math.max(1, Number(scene.duration_seconds || 8)),
    Number(option.max_duration_seconds || 600)
  );
  const prompt = [
    scene.title ? `Scene title: ${scene.title}` : null,
    scene.purpose ? `Story purpose: ${scene.purpose}` : null,
    scene.prompt ? `Visual direction: ${scene.prompt}` : null,
    scene.shot_direction ? `Camera direction: ${scene.shot_direction}` : null,
    scene.audio_sync ? `Audio sync: ${scene.audio_sync}` : null,
    `Continuity: ${scene.continuity_locked ? 'locked to the approved continuity.' : 'open for revision.'}`,
  ]
    .filter(Boolean)
    .join('\n');
  return {
    model: option.model,
    operation: option.operation || 'video',
    project_id: project.id,
    scene_id: scene.id,
    duration_seconds: duration,
    input: {
      prompt,
      aspect_ratio: project.visual_identity?.aspect_ratio || '16:9',
      duration,
      duration_seconds: duration,
    },
  };
}

export function normalizePickerProjects(projects = [], lane) {
  return projects
    .filter((project) => !lane || normalizedLane(project.lane) === normalizedLane(lane))
    .map((project) => ({
      id: project.id,
      lane: normalizedLane(project.lane),
      title: stringValue(project.title, 200) || 'Untitled project',
      status: stringValue(project.status, 100) || 'draft',
      updated_at: project.updated_at || null,
      logline: stringValue(project.logline),
    }));
}

export function generationRecoveryStorageKey(projectId) {
  return projectId ? `cinex-director-generation:${projectId}` : 'cinex-director-generation';
}

export function createGenerationAttempt({
  pendingGeneration,
  sceneId,
  createIdempotencyKey = () => crypto.randomUUID(),
}) {
  if (
    pendingGeneration?.sceneId === sceneId &&
    (pendingGeneration.requestId || pendingGeneration.idempotencyKey)
  ) {
    return { mode: pendingGeneration.requestId ? 'resume' : 'start', attempt: pendingGeneration };
  }
  return {
    mode: 'start',
    attempt: {
      sceneId,
      requestId: null,
      idempotencyKey: createIdempotencyKey(),
      createdAt: new Date().toISOString(),
    },
  };
}

export function withStartedGeneration(attempt, response) {
  return {
    ...attempt,
    requestId: response?.request_id || attempt?.requestId || null,
  };
}

export function preservePendingGeneration(attempt, error) {
  if (!attempt) return null;
  if (!error?.recoverable && !error?.requestId) return null;
  return {
    ...attempt,
    requestId: error.requestId || attempt.requestId || null,
  };
}

export function isMissingAudioSyncColumnResult(result) {
  const detail = [
    result?.data?.code,
    result?.data?.message,
    result?.data?.details,
    result?.data?.hint,
  ]
    .filter(Boolean)
    .join(' ');
  return /audio_sync/i.test(detail) && /(PGRST204|42703|column)/i.test(detail);
}

export function validateReservationStartPayload(body = {}) {
  if (!body.reservation_id || !body.model || !body.operation || !body.input) {
    return 'Job request is incomplete.';
  }
  return '';
}
