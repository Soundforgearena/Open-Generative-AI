import {
  guard,
  selectOne,
  insertRows,
  createSignedUploadUrl,
  safeError,
} from '../../../lib/cinexvideo-server';

const BUCKET = 'cinexvideo-references';
const ALLOWED = ['character', 'outfit', 'location', 'prop', 'reference', 'audio'];

/**
 * Issue a short-lived signed upload URL for a reference asset and record its
 * metadata. Files land in a private bucket — nothing is ever world-readable.
 */
export async function POST(request) {
  const { user, admin, error } = await guard(request, { blockOnMaintenance: true });
  if (error) return error;
  try {
    const body = await request.json();
    const { project_id: projectId, filename, kind = 'reference', name, notes = null } = body;
    if (!projectId || !filename) return safeError('Upload details are incomplete.');
    if (!ALLOWED.includes(kind)) return safeError('That reference type is not supported.');

    const project = await selectOne('projects', { id: `eq.${projectId}` }, 'id,owner_id');
    if (!project || (project.owner_id !== user.id && !admin)) return safeError('Project not found.', 404);

    const safeName = String(filename).replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
    const path = `${user.id}/${projectId}/${Date.now()}-${safeName}`;

    const uploadUrl = await createSignedUploadUrl(BUCKET, path);
    if (!uploadUrl) return safeError('Upload could not be prepared.', 502);

    const inserted = await insertRows('project_assets', {
      project_id: projectId,
      kind,
      name: (name || safeName).slice(0, 200),
      notes,
      storage_path: path,
    });
    if (!inserted.ok) return safeError('Reference could not be saved.', 500);

    return Response.json({ upload_url: uploadUrl, asset: inserted.data?.[0] || null }, { status: 201 });
  } catch (err) {
    console.error('uploads route', err);
    return safeError('Upload could not be prepared.', 500);
  }
}
