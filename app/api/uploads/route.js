import {
  guard,
  selectOne,
  insertRows,
  deleteRows,
  createSignedUploadUrl,
  createSignedDownloadUrl,
  deleteStorageObject,
  safeError,
} from '../../../lib/cinexvideo-server';
import { validateUploadDetails } from '../../../lib/upload-validation';

const BUCKET = 'cinexvideo-references';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Issue a short-lived signed upload URL for a reference asset and record its
 * metadata. Files land in a private bucket — nothing is ever world-readable.
 */
export async function POST(request) {
  const { user, admin, error } = await guard(request, { blockOnMaintenance: true });
  if (error) return error;
  try {
    const body = await request.json();
    const {
      project_id: projectId,
      filename,
      kind = 'reference',
      name,
      notes = null,
      content_type: contentType = null,
      size_bytes: sizeBytes = null,
    } = body;

    if (!projectId || !filename) return safeError('Upload details are incomplete.');
    if (!UUID_RE.test(String(projectId))) return safeError('Invalid project id.', 400);

    const resolved = validateUploadDetails({ kind, filename, contentType, sizeBytes });
    if (!resolved.ok) return safeError(resolved.message, resolved.status || 415);

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

    const asset = inserted.data?.[0] || null;

    return Response.json(
      {
        upload_url: uploadUrl,
        content_type: resolved.contentType,
        asset: asset
          ? { ...asset, preview_url: await createSignedDownloadUrl(BUCKET, path) }
          : null,
      },
      { status: 201 }
    );
  } catch (err) {
    console.error('uploads route', err);
    return safeError('Upload could not be prepared.', 500);
  }
}

/** Remove a reference the owner no longer wants, including its stored file. */
export async function DELETE(request) {
  const { user, admin, error } = await guard(request);
  if (error) return error;
  try {
    const assetId = new URL(request.url).searchParams.get('asset_id');
    if (!assetId || !UUID_RE.test(assetId)) return safeError('Invalid reference id.', 400);

    const asset = await selectOne('project_assets', { id: `eq.${assetId}` }, 'id,project_id,storage_path,locked');
    if (!asset) return safeError('Reference not found.', 404);
    if (asset.locked && !admin) return safeError('That reference is locked and cannot be removed.', 409);

    const project = await selectOne('projects', { id: `eq.${asset.project_id}` }, 'id,owner_id');
    if (!project || (project.owner_id !== user.id && !admin)) return safeError('Reference not found.', 404);

    if (asset.storage_path) await deleteStorageObject(BUCKET, asset.storage_path);
    const removed = await deleteRows('project_assets', { id: `eq.${assetId}` });
    if (!removed.ok) return safeError('Reference could not be removed.', 500);

    return Response.json({ removed: assetId });
  } catch (err) {
    console.error('uploads delete', err);
    return safeError('Reference could not be removed.', 500);
  }
}
