import { guard, selectOne, updateRows, deleteStorageObject, safeError } from '../../../../../lib/cinexvideo-server';
import { activeR2Environment } from '../../../../../lib/storage/r2-server';
import { exactSizeStream, mediaReadUrl, parseR2Path, r2AssetPathMatches } from '../../../../../lib/storage/media-tokens';
import { presignUrl } from '../../../../../lib/storage/provider';
import { rateLimit } from '../../../../../lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PUT(request, { params }) {
  const { user, admin, error } = await guard(request, { blockOnMaintenance: true });
  if (error) return error;
  const limited = rateLimit(`r2-upload:${user.id}`, { limit: 30, windowMs: 60000 });
  if (limited) return limited;
  const { id } = await params;
  if (!/^[a-f0-9-]{36}$/i.test(id || '')) return safeError('Invalid upload.', 400);
  const asset = await selectOne('project_assets', { id: `eq.${id}` });
  if (!asset || asset.storage_backend !== 'r2') return safeError('Upload not found.', 404);
  const project = await selectOne('projects', { id: `eq.${asset.project_id}` }, 'owner_id');
  if (!project || (project.owner_id !== user.id && !admin)) return safeError('Upload not found.', 404);
  if (!r2AssetPathMatches(asset, project.owner_id)) return safeError('Invalid media reference.', 409);
  if (!request.body) return safeError('The upload is empty.');
  if (request.headers.get('content-type') !== asset.content_type) return safeError('The upload type does not match its reservation.');
  const length = request.headers.get('content-length');
  if (length !== null && Number(length) !== Number(asset.size_bytes)) return safeError('The upload size does not match its reservation.');
  const claimed = await updateRows('project_assets', { id: `eq.${id}`, upload_state: 'eq.pending' }, { upload_state: 'uploading' });
  if (!claimed.ok || !claimed.data?.length) return safeError('This upload is already running or complete.', 409);
  try {
    const env = await activeR2Environment();
    const object = parseR2Path(asset.storage_path);
    if (object.bucket !== env.STORAGE_S3_BUCKET) throw new Error('connection changed');
    const response = await fetch(presignUrl('PUT', object.key, { env, expiresIn: 900 }), {
      method: 'PUT',
      body: exactSizeStream(request.body, Number(asset.size_bytes)),
      duplex: 'half',
      headers: { 'Content-Type': asset.content_type, 'Content-Length': String(asset.size_bytes) },
      redirect: 'error',
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(120000)]),
    });
    if (!response.ok) throw new Error('storage rejected upload');
    const saved = await updateRows('project_assets', { id: `eq.${id}`, upload_state: 'eq.uploading' }, { upload_state: 'ready' });
    if (!saved.ok || !saved.data?.length) throw new Error('upload confirmation failed');
    return Response.json({ asset: { ...saved.data[0], preview_url: mediaReadUrl(asset.storage_path) } }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    await deleteStorageObject('cinexvideo-references', asset.storage_path).catch(() => false);
    await updateRows('project_assets', { id: `eq.${id}`, upload_state: 'eq.uploading' }, { upload_state: 'pending' });
    return safeError('The upload could not be verified. It was not added to your library. Please retry.', 502);
  }
}
