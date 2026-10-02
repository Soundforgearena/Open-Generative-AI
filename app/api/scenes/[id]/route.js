import { guard, selectOne, selectRows, updateRows, deleteRows, safeError } from '../../../../lib/cinexvideo-server';
import { sceneIds, writeSceneOrder } from '../../../../lib/studio/scene-store';

async function ownedScene(id, user, admin) {
  const scene = await selectOne('scenes', { id: `eq.${id}` });
  if (!scene) return null;
  const project = await selectOne('projects', { id: `eq.${scene.project_id}` }, 'owner_id');
  if (!project) return null;
  if (project.owner_id !== user.id && !admin) return null;
  return scene;
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

  const scene = await ownedScene(id, user, admin);
  if (!scene) return safeError('Scene not found.', 404);

  const body = await request.json();
  const patch = {};

  if (typeof body.title === 'string' && body.title.trim()) patch.title = body.title.trim().slice(0, 200);
  if (typeof body.purpose === 'string') patch.purpose = body.purpose.slice(0, 5000);
  if (typeof body.prompt === 'string') patch.prompt = body.prompt.slice(0, 5000);
  if (typeof body.shot_direction === 'string') patch.shot_direction = body.shot_direction.slice(0, 5000);
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

  const updated = await updateRows('scenes', { id: `eq.${id}` }, patch);
  if (!updated.ok) return safeError('Scene could not be updated.', 500);
  return Response.json({ scene: updated.data?.[0] || null });
}

/**
 * Delete a scene. Scenes with generated takes need { confirm_takes: true }
 * because their takes are removed with them. Running generations block delete.
 */
export async function DELETE(request, { params }) {
  const { user, admin, error } = await guard(request, { blockOnMaintenance: true });
  if (error) return error;
  const { id } = await params;
  const scene = await ownedScene(id, user, admin);
  if (!scene) return safeError('Scene not found.', 404);
  if (scene.status === 'generating') return safeError('Wait for this scene to finish generating before deleting it.', 409);

  const ids = await sceneIds(scene.project_id);
  if (ids.length <= 1) return safeError('A project needs at least one scene.', 409);

  const body = await request.json().catch(() => ({}));
  const takes = await selectRows('scene_versions', { scene_id: `eq.${id}`, status: 'eq.completed' }, 'id');
  if (takes.length && body.confirm_takes !== true) {
    return Response.json({ error: 'This scene has generated takes.', takes: takes.length, requires_confirmation: true }, { status: 409 });
  }

  const removed = await deleteRows('scenes', { id: `eq.${id}` });
  if (removed && removed.ok === false) return safeError('Scene could not be deleted.', 500);
  await writeSceneOrder(scene.project_id, ids.filter((x) => x !== id));
  return Response.json({ deleted: id });
}
