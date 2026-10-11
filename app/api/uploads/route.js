import {
  guard,
  selectOne,
  callRpc,
  updateRows,
  deleteRows,
  createSignedDownloadUrl,
  deleteStorageObject,
  safeError,
} from '../../../lib/cinexvideo-server';
import { validateUploadDetails } from '../../../lib/upload-validation';
import { rateLimit } from '../../../lib/rate-limit';
import { activeR2Environment } from '../../../lib/storage/r2-server';
import { r2AssetPathMatches } from '../../../lib/storage/media-tokens';

const BUCKET = 'cinexvideo-references';
const MAX_FILES_PER_PROJECT = 30;
const USER_QUOTA_BYTES = (Number(process.env.UPLOAD_QUOTA_MB) || 500) * 1024 * 1024;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Reserve quota and a private R2 object. Bytes go through the authenticated
 * same-origin endpoint so operators do not need to configure bucket CORS.
 */
export async function POST(request) {
  const { user, admin, error } = await guard(request, { blockOnMaintenance: true });
  if (error) return error;
  const limited = rateLimit(`upload:${user.id}`, { limit: 30, windowMs: 60_000 });
  if (limited) return limited;
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

    let storage;
    try { storage = await activeR2Environment(); }
    catch { return safeError('Media storage is not connected. A super admin must connect Cloudflare R2 in Admin settings.', 503); }
    const safeName = String(filename).replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
    const id = crypto.randomUUID();
    const path = `r2://${storage.STORAGE_S3_BUCKET}/refs/${project.owner_id}/${projectId}/${id}`;
    const reserved = await callRpc('reserve_r2_reference_upload', {
      p_asset_id: id, p_project_id: projectId, p_owner_id: project.owner_id,
      p_kind: kind, p_name: String(name || safeName).slice(0, 200),
      p_notes: notes ? String(notes).slice(0, 2000) : null, p_path: path,
      p_size_bytes: Number(sizeBytes), p_content_type: resolved.contentType,
      p_quota_bytes: USER_QUOTA_BYTES, p_admin: admin,
    });
    if (!reserved.ok) {
      const message = reserved.data?.message || '';
      if (message.includes('PROJECT_FILE_LIMIT')) return safeError(`This project already has ${MAX_FILES_PER_PROJECT} references. Remove one to upload another.`, 409);
      if (message.includes('STORAGE_QUOTA_EXCEEDED')) return safeError(`You've used your ${Math.round(USER_QUOTA_BYTES / 1048576)} MB of reference storage. Remove references you no longer need to upload more.`, 413);
      return safeError('Storage could not reserve this upload. Please try again shortly.', 503);
    }
    const asset = Array.isArray(reserved.data) ? reserved.data[0] : reserved.data;
    if (!asset?.id) return safeError('Storage could not reserve this upload.', 503);

    return Response.json(
      {
        upload_url: `/api/uploads/${id}/content`,
        transport: 'r2-proxy',
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

    const asset = await selectOne('project_assets', { id: `eq.${assetId}` }, 'id,project_id,storage_path,locked,upload_state');
    if (!asset) return safeError('Reference not found.', 404);
    if (asset.locked && !admin) return safeError('That reference is locked and cannot be removed.', 409);

    const project = await selectOne('projects', { id: `eq.${asset.project_id}` }, 'id,owner_id');
    if (!project || (project.owner_id !== user.id && !admin)) return safeError('Reference not found.', 404);
    if (asset.storage_path?.startsWith('r2://') && !r2AssetPathMatches(asset, project.owner_id)) return safeError('Invalid media reference.', 409);

    if (asset.upload_state === 'uploading') return safeError('This upload is still running. Try removing it after it finishes.', 409);
    const claimed = asset.upload_state === 'deleting' ? { ok: true, data: [asset] }
      : await updateRows('project_assets', { id: `eq.${assetId}`, upload_state: `eq.${asset.upload_state || 'ready'}` }, { upload_state: 'deleting' });
    if (!claimed.ok || !claimed.data?.length) return safeError('This reference changed. Refresh and try again.', 409);
    try {
      if (asset.storage_path && !await deleteStorageObject(BUCKET, asset.storage_path)) throw new Error('delete failed');
    } catch {
      await updateRows('project_assets', { id: `eq.${assetId}`, upload_state: 'eq.deleting' }, { upload_state: asset.upload_state === 'pending' ? 'pending' : 'ready' });
      return safeError('The media could not be removed from storage. Its record was retained so you can retry.', 503);
    }
    const removed = await deleteRows('project_assets', { id: `eq.${assetId}`, upload_state: 'eq.deleting' });
    if (!removed.ok) return safeError('Reference could not be removed.', 500);

    return Response.json({ removed: assetId });
  } catch (err) {
    console.error('uploads delete', { name: err?.name });
    return safeError('Reference could not be removed.', 500);
  }
}
