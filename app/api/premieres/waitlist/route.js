import { getBearerUser, insertRows, safeError, selectRows } from '../../../../lib/cinexvideo-server';
import { rateLimit } from '../../../../lib/rate-limit';
import { createTtlCache } from '../../../../lib/ttl-cache';

export const dynamic = 'force-dynamic';

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i;

/** Join the CineX Premieres waitlist as a viewer or a creator. */
export async function POST(request) {
  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
  const limited = rateLimit(`waitlist:${ip}`, { limit: 5, windowMs: 60_000 });
  if (limited) return limited;
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || '').trim().slice(0, 254);
  const role = body.role === 'creator' ? 'creator' : 'viewer';
  if (!EMAIL_RE.test(email)) return safeError('Enter a valid email address.', 400);
  const user = await getBearerUser(request).catch(() => null);
  const result = await insertRows('premiere_waitlist', { email: email.toLowerCase(), role, user_id: user?.id || null });
  if (!result.ok) {
    // Already on the list is a success for the visitor.
    if (result.data?.code === '23505') {
      return Response.json({ ok: true, already: true });
    }
    return safeError('Could not save your spot. Please try again.', 500);
  }
  return Response.json({ ok: true });
}

/** Public count for the "people waiting" counter. */
const countCache = createTtlCache({ ttlMs: 60_000, max: 1 });

export async function GET() {
  const count = await countCache
    .get('count', async () => (await selectRows('premiere_waitlist', { limit: '100000' }, 'id')).length)
    .catch(() => 0);
  return Response.json({ count }, { headers: { 'Cache-Control': 'public, max-age=60, s-maxage=120' } });
}
