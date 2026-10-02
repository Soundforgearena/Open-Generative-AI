import { guard, selectOne, insertRows, safeError } from '../../../../../lib/cinexvideo-server';
import { MAX_SCENES, moveId, newSceneFields } from '../../../../../lib/studio/scene-order';
import { sceneIds, writeSceneOrder } from '../../../../../lib/studio/scene-store';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function ownedProject(id, user, admin) {
  const project = await selectOne('projects', { id: `eq.${id}` }, 'id,owner_id');
  if (!project || (project.owner_id !== user.id && !admin)) return null;
  return project;
}

/** Add a scene (blank or duplicated from another scene) after a given scene. */
export async function POST(request, { params }) {
  const { user, admin, error } = await guard(request, { blockOnMaintenance: true });
  if (error) return error;
  const { id } = await params;
  if (!UUID_RE.test(id || '')) return safeError('Invalid project id.', 400);
  if (!(await ownedProject(id, user, admin))) return safeError('Project not found.', 404);

  const body = await request.json().catch(() => ({}));
  const ids = await sceneIds(id);
  if (ids.length >= MAX_SCENES) return safeError(`Projects can have up to ${MAX_SCENES} scenes.`, 409);

  let source = {};
  if (body.duplicate_of) {
    const original = await selectOne('scenes', { id: `eq.${body.duplicate_of}`, project_id: `eq.${id}` });
    if (!original) return safeError('Scene not found.', 404);
    source = { ...original, title: `${original.title} (copy)`.slice(0, 200) };
  } else {
    source = body;
  }

  const fields = newSceneFields(source, `Scene ${ids.length + 1}`);
  const created = await insertRows('scenes', { ...fields, project_id: id, position: ids.length + 1 });
  const row = Array.isArray(created.data) ? created.data[0] : created.data;
  if (!created.ok || !row) return safeError('Scene could not be created.', 500);

  const afterIndex = body.after_scene_id ? ids.indexOf(body.after_scene_id) : ids.length - 1;
  const order = moveId([...ids, row.id], row.id, afterIndex + 1);
  if (!(await writeSceneOrder(id, order))) return safeError('Scene order could not be saved.', 500);
  return Response.json({ scene: { ...row, position: order.indexOf(row.id) + 1 } }, { status: 201 });
}

/** Reorder: { order: [sceneId, ...] } must contain exactly the project's scenes. */
export async function PATCH(request, { params }) {
  const { user, admin, error } = await guard(request, { blockOnMaintenance: true });
  if (error) return error;
  const { id } = await params;
  if (!UUID_RE.test(id || '')) return safeError('Invalid project id.', 400);
  if (!(await ownedProject(id, user, admin))) return safeError('Project not found.', 404);

  const body = await request.json().catch(() => ({}));
  const ids = await sceneIds(id);
  const order = Array.isArray(body.order) ? body.order.map(String) : [];
  const same = order.length === ids.length && new Set(order).size === order.length && order.every((x) => ids.includes(x));
  if (!same) return safeError('Scene order does not match this project.', 400);
  if (!(await writeSceneOrder(id, order))) return safeError('Scene order could not be saved.', 500);
  return Response.json({ order });
}
