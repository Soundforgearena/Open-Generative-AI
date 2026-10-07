import { guard, safeError } from '../../../../lib/cinexvideo-server';
import { describeStorage, testStorageConnection } from '../../../../lib/storage/provider';
import { describeModeration, POLICY_VERSION } from '../../../../lib/premieres/content-policy';
import { describeAds } from '../../../../lib/premieres/revenue';
import { selectRows } from '../../../../lib/cinexvideo-server';

export const dynamic = 'force-dynamic';

/** Storage server hookup status (names only, never secrets). */
export async function GET(request) {
  const { error } = await guard(request, { requireAdminRole: true });
  if (error) return error;
  const waitlist = await selectRows('premiere_waitlist', { limit: '100000' }, 'role').catch(() => []);
  return Response.json({
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
