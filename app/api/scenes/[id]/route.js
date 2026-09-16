import { guard, selectOne, updateRows, safeError } from '../../../../lib/cinexvideo-server';
import {
  buildDirectorPlanPatch,
  invalidateDirectorWorkflow,
  isMissingAudioSyncColumnResult,
  scenePatchTouchesGeneration,
} from '../../../../lib/director-workflow';

async function ownedScene(id, user, admin) {
  const scene = await selectOne('scenes', { id: `eq.${id}` });
  if (!scene) return null;
  const project = await selectOne(
    'projects',
    { id: `eq.${scene.project_id}` },
    'id,owner_id,lane,director_plan,title,logline,visual_identity'
  );
  if (!project) return null;
  if (project.owner_id !== user.id && !admin) return null;
  return { scene, project };
}

/**
 * Scene edits: prompt, duration, continuity lock, approval, and promoting a
 * regenerated take. Regeneration never overwrites the live version — a new take
 * is created and only becomes active once it is approved here.
 */
export async function PATCH(request, { params }) {
  const { user, admin, error } = await guard(request);
  if (error) return error;
  const { id } = await params;

  const owned = await ownedScene(id, user, admin);
  if (!owned) return safeError('Scene not found.', 404);
  const { scene, project } = owned;

  const body = await request.json();
  const patch = {};

  if (typeof body.title === 'string' && body.title.trim()) patch.title = body.title.trim().slice(0, 200);
  if (typeof body.purpose === 'string') patch.purpose = body.purpose.slice(0, 5000);
  if (typeof body.prompt === 'string') patch.prompt = body.prompt.slice(0, 5000);
  if (typeof body.shot_direction === 'string') patch.shot_direction = body.shot_direction.slice(0, 5000);
  if (typeof body.audio_sync === 'string') patch.audio_sync = body.audio_sync.slice(0, 5000);
  if (Number.isFinite(Number(body.duration_seconds))) {
    patch.duration_seconds = Math.min(Math.max(Number(body.duration_seconds), 1), 600);
  }
  if (typeof body.continuity_locked === 'boolean') patch.continuity_locked = body.continuity_locked;
  if (Number.isFinite(Number(body.position))) patch.position = Number(body.position);

  // Promote a specific take to be the scene's active version.
  if (Number.isFinite(Number(body.approve_version))) {
    const version = Number(body.approve_version);
    const take = await selectOne(
      'scene_versions',
      { scene_id: `eq.${id}`, version: `eq.${version}` },
      'id,status'
    );
    if (!take) return safeError('That take does not exist.', 404);
    if (take.status !== 'completed') return safeError('That take is not ready yet.', 409);
    await updateRows('scene_versions', { scene_id: `eq.${id}` }, { approved: false });
    await updateRows('scene_versions', { scene_id: `eq.${id}`, version: `eq.${version}` }, { approved: true });
    patch.active_version = version;
    patch.status = 'approved';
  }

  if (!Object.keys(patch).length) return safeError('Nothing to update.');

  let nextDirectorPlan = null;
  if (scenePatchTouchesGeneration(scene, patch)) {
    const { workflow } = invalidateDirectorWorkflow({
      lane: project.lane,
      directorPlan: project.director_plan,
    });
    nextDirectorPlan = buildDirectorPlanPatch({
      lane: project.lane,
      workflow,
      existingPlan: project.director_plan,
      projectMeta: {
        title: project.title,
        logline: project.logline,
        visual_identity: project.visual_identity,
      },
    });
    const invalidated = await updateRows('projects', { id: `eq.${project.id}` }, { director_plan: nextDirectorPlan });
    if (!invalidated.ok) return safeError('Project approvals could not be updated.', 500);
  }

  const updated = await updateRows('scenes', { id: `eq.${id}` }, patch);
  if (!updated.ok) {
    if (Object.hasOwn(patch, 'audio_sync') && isMissingAudioSyncColumnResult(updated)) {
      return safeError('Audio Sync will be available after the latest scene schema migration is applied.', 503);
    }
    return safeError('Scene could not be updated.', 500);
  }
  return Response.json({
    scene: updated.data?.[0] || null,
    director_plan: nextDirectorPlan,
  });
}
