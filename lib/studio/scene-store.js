import { selectRows, updateRows } from '../cinexvideo-server';

/**
 * Rewrites scene positions to match `orderedIds`. Positions are unique per
 * project, so rows are parked on negative positions first, then set to 1..n.
 */
export async function writeSceneOrder(projectId, orderedIds) {
  for (let i = 0; i < orderedIds.length; i += 1) {
    const r = await updateRows('scenes', { id: `eq.${orderedIds[i]}`, project_id: `eq.${projectId}` }, { position: -(i + 1) });
    if (!r.ok) return false;
  }
  for (let i = 0; i < orderedIds.length; i += 1) {
    const r = await updateRows('scenes', { id: `eq.${orderedIds[i]}`, project_id: `eq.${projectId}` }, { position: i + 1 });
    if (!r.ok) return false;
  }
  return true;
}

export async function sceneIds(projectId) {
  const rows = await selectRows('scenes', { project_id: `eq.${projectId}`, order: 'position.asc' }, 'id');
  return rows.map((r) => r.id);
}
