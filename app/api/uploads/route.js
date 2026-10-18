import {
  guard,
  selectOne,
  selectRows,
  callRpc,
  insertRows,
  deleteRows,
  updateRows,
  createSignedUploadUrl,
  createSignedDownloadUrl,
  deleteStorageObject,
  safeError,
} from '../../../lib/cinexvideo-server';
import { canWrite } from '../../../lib/studio/access';
import { validateUploadDetails } from '../../../lib/upload-validation';
import { rateLimit } from '../../../lib/rate-limit';

const BUCKET = 'cinexvideo-references';
const MAX_FILES_PER_PROJECT = 30;
const USER_QUOTA_BYTES = (Number(process.env.UPLOAD_QUOTA_MB) || 500) * 1024 * 1024;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Issue a short-lived signed upload URL for a reference asset and record its
 * metadata. Files land in a private bucket — nothing is ever world-readable.
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
      likeness_consent: likenessConsent = false,
    } = body;

    if (!projectId || !filename) return safeError('Upload details are incomplete.');
    if (!UUID_RE.test(String(projectId))) return safeError('Invalid project id.', 400);

    const resolved = validateUploadDetails({ kind, filename, contentType, sizeBytes });
    if (!resolved.ok) return safeError(resolved.message, resolved.status || 415);

    const project = await selectOne('projects', { id: `eq.${projectId}` }, 'id,owner_id');
    if (!canWrite(project, { user })) return safeError('Project not found.', 404);

    // Storage protection: cap files per project and total bytes per user so
    // no single account can fill the storage the whole app depends on.
    const existing = await selectRows('project_assets', { project_id: `eq.${projectId}` }, 'id');
    if (existing.length >= MAX_FILES_PER_PROJECT) {
      return safeError(`This project already has ${MAX_FILES_PER_PROJECT} references. Remove one to upload another.`, 409);
    }
    if (!admin) {
      const used = await callRpc('storage_used_bytes', { p_user_id: user.id });
      const usedBytes = used.ok ? Number(used.data) || 0 : 0;
      if (usedBytes + (Number(sizeBytes) || 0) > USER_QUOTA_BYTES) {
        return safeError(`You've used your ${Math.round(USER_QUOTA_BYTES / 1048576)} MB of reference storage. Remove references you no longer need to upload more.`, 413);
      }
    }

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
      // Only a character photo or a dance clip can carry permission to use
      // the people in it.
      ...((kind === 'character' || kind === 'motion') && likenessConsent === true
        ? { likeness_consent: true, likeness_consent_at: new Date().toISOString() }
        : {}),
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
    if (!canWrite(project, { user })) return safeError('Reference not found.', 404);

    if (asset.storage_path) await deleteStorageObject(BUCKET, asset.storage_path);
    const removed = await deleteRows('project_assets', { id: `eq.${assetId}` });
    if (!removed.ok) return safeError('Reference could not be removed.', 500);

    return Response.json({ removed: assetId });
  } catch (err) {
    console.error('uploads delete', err);
    return safeError('Reference could not be removed.', 500);
  }
}

/**
 * Confirm or withdraw permission to use the face in a character photo.
 * Withdrawing unlinks it from every scene so it can never be generated again.
 */
export async function PATCH(request) {
  const { user, admin, error } = await guard(request);
  if (error) return error;
  try {
    const body = await request.json();
    const assetId = String(body.asset_id || '');
    if (!UUID_RE.test(assetId)) return safeError('Invalid reference id.', 400);
    const asset = await selectOne('project_assets', { id: `eq.${assetId}` }, 'id,project_id,kind,storage_path');
    if (!asset) return safeError('Reference not found.', 404);
    const project = await selectOne('projects', { id: `eq.${asset.project_id}` }, 'id,owner_id');
    if (!canWrite(project, { user })) return safeError('Reference not found.', 404);
    const patch = {};
    if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim().slice(0, 200);
    if (typeof body.notes === 'string') patch.notes = body.notes.slice(0, 1000);
    if (typeof body.likeness_consent === 'boolean') {
      if (body.likeness_consent && asset.kind !== 'character' && asset.kind !== 'motion') return safeError('Only character photos and dance clips can carry permission.', 400);
      if (body.likeness_consent && !asset.storage_path) return safeError('Add a photo first.', 409);
      patch.likeness_consent = body.likeness_consent;
      patch.likeness_consent_at = body.likeness_consent ? new Date().toISOString() : null;
    }
    if (!Object.keys(patch).length) return safeError('Nothing to update.');
    const updated = await updateRows('project_assets', { id: `eq.${assetId}` }, patch);
    if (!updated.ok) return safeError('Reference could not be updated.', 500);
    if (patch.likeness_consent === false) {
      await updateRows('scenes', { character_asset_id: `eq.${assetId}` }, { character_asset_id: null });
      await updateRows('scenes', { motion_asset_id: `eq.${assetId}` }, { motion_asset_id: null });
    }
    return Response.json({ asset: updated.data?.[0] || null });
  } catch (err) {
    console.error('uploads patch', err);
    return safeError('Reference could not be updated.', 500);
  }
}
