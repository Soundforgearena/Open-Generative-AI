import {
  guard,
  selectOne,
  selectRows,
  updateRows,
  createSignedDownloadUrl,
  safeError,
} from '../../../../lib/cinexvideo-server';

const BUCKET = 'cinexvideo-references';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function ownedProject(id, user, admin) {
  const project = await selectOne('projects', { id: `eq.${id}` });
  if (!project) return null;
  if (project.owner_id !== user.id && !admin) return null;
  return project;
}

/** Full project payload: scenes with their takes, plus the reference library. */
export async function GET(request, { params }) {
  const { user, admin, error } = await guard(request);
  if (error) return error;
  const { id } = await params;
  if (!UUID_RE.test(id || '')) return safeError('Invalid project id.', 400);

  const project = await ownedProject(id, user, admin);
  if (!project) return safeError('Project not found.', 404);

  const scenes = await selectRows('scenes', { project_id: `eq.${id}`, order: 'position.asc' });
  const assets = await selectRows('project_assets', { project_id: `eq.${id}`, order: 'created_at.asc' });

  const versions = scenes.length
    ? await selectRows('scene_versions', {
        scene_id: `in.(${scenes.map((scene) => scene.id).join(',')})`,
        order: 'version.desc',
      })
    : [];

  // References live in a private bucket; hand back short-lived signed URLs only.
  const library = await Promise.all(
    assets.map(async (asset) => ({
      ...asset,
      preview_url: asset.storage_path ? await createSignedDownloadUrl(BUCKET, asset.storage_path) : null,
    }))
  );

  return Response.json({
    project: {
      id: project.id,
      lane: project.lane,
      title: project.title,
      logline: project.logline,
      visual_identity: project.visual_identity,
      status: project.status,
    },
    scenes: scenes.map((scene) => ({
      ...scene,
      versions: versions.filter((version) => version.scene_id === scene.id),
    })),
    assets: library,
  });
}

/** Rename a project, change lane, or archive it. */
export async function PATCH(request, { params }) {
  const { user, admin, error } = await guard(request);
  if (error) return error;
  const { id } = await params;
  if (!UUID_RE.test(id || '')) return safeError('Invalid project id.', 400);
  if (!(await ownedProject(id, user, admin))) return safeError('Project not found.', 404);

  const body = await request.json();
  const patch = {};
  if (typeof body.title === 'string' && body.title.trim()) patch.title = body.title.trim().slice(0, 200);
  if (['draft', 'in_production', 'delivered', 'archived'].includes(body.status)) patch.status = body.status;
  if (!Object.keys(patch).length) return safeError('Nothing to update.');

  const updated = await updateRows('projects', { id: `eq.${id}` }, patch);
  if (!updated.ok) return safeError('Project could not be updated.', 500);
  return Response.json({ project: updated.data?.[0] || null });
}
