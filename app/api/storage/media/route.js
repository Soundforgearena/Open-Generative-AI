import { selectOne, safeError } from '../../../../lib/cinexvideo-server';
import { activeR2Environment } from '../../../../lib/storage/r2-server';
import { parseR2Path, verifyMediaRead, r2AssetPathMatches } from '../../../../lib/storage/media-tokens';
import { presignUrl } from '../../../../lib/storage/provider';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** A short-lived capability URL is issued only after an ownership check. */
export async function GET(request) {
  const query = new URL(request.url).searchParams;
  const path = query.get('path');
  if (!verifyMediaRead(path, query.get('expires'), query.get('signature'))) return safeError('This media link is invalid or expired.', 403);
  try {
    const asset = await selectOne('project_assets', { storage_path: `eq.${path}`, upload_state: 'eq.ready' }, 'id,project_id,storage_path,content_type');
    if (!asset) return safeError('Media not found.', 404);
    const project = await selectOne('projects', { id: `eq.${asset.project_id}` }, 'owner_id');
    if (!project || !r2AssetPathMatches(asset, project.owner_id)) return safeError('Media not found.', 404);
    const env = await activeR2Environment();
    const object = parseR2Path(path);
    if (object.bucket !== env.STORAGE_S3_BUCKET) return safeError('Media connection is unavailable.', 503);
    const range = request.headers.get('range');
    if (range && !/^bytes=\d*-\d*$/.test(range)) return safeError('Unsupported media range.', 416);
    const upstream = await fetch(presignUrl('GET', object.key, { env, expiresIn: 60 }), {
      headers: range ? { Range: range } : {}, redirect: 'error',
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(120000)]),
    });
    if (!upstream.ok) return safeError('Media is unavailable.', upstream.status === 404 ? 404 : upstream.status === 416 ? 416 : 502);
    const headers = new Headers({
      'Content-Type': asset.content_type || 'application/octet-stream',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Accept-Ranges': 'bytes',
      'Referrer-Policy': 'no-referrer',
    });
    for (const name of ['content-length', 'content-range']) {
      if (upstream.headers.has(name)) headers.set(name, upstream.headers.get(name));
    }
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch { return safeError('Private media could not be loaded.', 503); }
}
