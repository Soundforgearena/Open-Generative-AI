import { guard, safeError } from '../../../../lib/cinexvideo-server';
import { describeStorage, testStorageConnection } from '../../../../lib/storage/provider';
import { describeModeration, POLICY_VERSION } from '../../../../lib/premieres/content-policy';
import { describeAds } from '../../../../lib/premieres/revenue';
import { selectRows } from '../../../../lib/cinexvideo-server';

export const dynamic = 'force-dynamic';

/** Storage server hookup status (names only, never secrets). */
export async function GET(request) {
  const { superAdmin, error } = await guard(request, { requireAdminRole: true });
  if (error) return error;
  const waitlist = await selectRows('premiere_waitlist', { limit: '100000' }, 'role').catch(() => []);
  // Super admin only: how much the stored takes and stills use, per user, and
  // the weekly orphan report (files nothing points at; review before deleting).
  let media = null;
  if (superAdmin) {
    const rows = await selectRows('media_objects', { limit: '200000' }, 'owner_id,size_bytes').catch(() => null);
    const orphans = await selectRows('media_orphans', { order: 'created_at.asc', limit: '500' }, 'object_key,owner_id,kind,size_bytes,created_at').catch(() => null);
    if (rows) {
      const perUser = new Map();
      rows.forEach((r) => perUser.set(r.owner_id, (perUser.get(r.owner_id) || 0) + Number(r.size_bytes || 0)));
      media = {
        objects: rows.length,
        bytes: rows.reduce((n, r) => n + Number(r.size_bytes || 0), 0),
        top_users: [...perUser.entries()].sort((x, y) => y[1] - x[1]).slice(0, 10).map(([owner_id, bytes]) => ({ owner_id, bytes })),
        orphans: orphans ? { count: orphans.length, bytes: orphans.reduce((n, r) => n + Number(r.size_bytes || 0), 0), items: orphans.slice(0, 50) } : null,
      };
    }
  }
  return Response.json({
    media,
    storage: describeStorage(),
    moderation: describeModeration(process.env),
    ads: describeAds(process.env),
    policy_version: POLICY_VERSION,
    waitlist: { total: waitlist.length, creators: waitlist.filter((w) => w.role === 'creator').length },
  });
}

/** Super admin: run a live write/read/delete test against the storage server. */
export async function POST(request) {
  const { superAdmin, error } = await guard(request, { requireAdminRole: true });
  if (error) return error;
  if (!superAdmin) return safeError('Only a super admin can test the storage server.', 403);
  if (!describeStorage().configured) return safeError('Storage server is not connected yet. Add the STORAGE_S3_* settings in Railway first.', 409);
  try {
    return Response.json(await testStorageConnection());
  } catch (err) {
    console.error('storage test', err.message);
    return Response.json({ ok: false, step: 'network' });
  }
}
