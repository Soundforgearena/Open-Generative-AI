import { guard, insertRows, listAuthUsers, safeError, selectOne, selectRows, updateRows } from '../../../../lib/cinexvideo-server';
import { resolveMedia } from '../../../../lib/storage/media.js';
import { CASE_STATUSES } from '../../../../lib/moderation/cases.js';
import { MODERATION_MODEL, MODERATION_POLICY_VERSION, moderate } from '../../../../lib/moderation/moderate.js';

export const dynamic = 'force-dynamic';

/** Super admin: the moderation review queue (previews are 15-minute links). */
export async function GET(request) {
  const { superAdmin, error } = await guard(request, { requireAdminRole: true });
  if (error) return error;
  if (!superAdmin) return safeError('Only the super admin can open the review queue.', 403);
  const url = new URL(request.url);
  const status = url.searchParams.get('status') || 'open';
  const filters = { order: 'created_at.desc', limit: '200' };
  if (status !== 'all' && CASE_STATUSES.includes(status)) filters.status = `eq.${status}`;
  const [rows, users, counts] = await Promise.all([
    selectRows('moderation_cases', filters, '*').catch(() => null),
    listAuthUsers().catch(() => new Map()),
    selectRows('moderation_cases', { limit: '100000' }, 'status,severe').catch(() => []),
  ]);
  if (!rows) return safeError('The review queue is not available yet.', 503);
  return Response.json({
    model: MODERATION_MODEL,
    policy: MODERATION_POLICY_VERSION,
    configured: Boolean(process.env.OPENAI_API_KEY),
    counts: {
      open: counts.filter((c) => c.status === 'open').length,
      severe_open: counts.filter((c) => c.status === 'open' && c.severe).length,
      total: counts.length,
    },
    cases: rows.map((c) => ({
      ...c,
      email: users.get(c.user_id)?.email || null,
      preview_url: c.media_ref ? resolveMedia(c.media_ref, { expiresIn: 900 }) : null,
      media_ref: undefined,
    })),
  });
}

/**
 * Super admin: review a case. Admins may also run a text check (free, never
 * stored), so the rules can be tested without making anything.
 */
export async function POST(request) {
  const { user, superAdmin, error } = await guard(request, { requireAdminRole: true });
  if (error) return error;
  const body = await request.json().catch(() => ({}));
  if (body.action === 'test') {
    const text = String(body.text || '').slice(0, 4000);
    if (!text.trim()) return safeError('Type something to check.');
    const verdict = await moderate({ text });
    return Response.json({ allowed: verdict.allowed, unchecked: Boolean(verdict.unchecked), categories: verdict.categories, labels: verdict.labels, scores: verdict.top });
  }
  if (!superAdmin) return safeError('Only the super admin can review cases.', 403);
  if (body.action !== 'review') return safeError('Unknown action.');
  const status = String(body.status || '');
  if (!['confirmed', 'false_positive', 'reported'].includes(status)) return safeError('Choose confirmed, false positive or reported.');
  const existing = await selectOne('moderation_cases', { id: `eq.${body.id}` }, 'id,user_id,account_suspended,status');
  if (!existing) return safeError('Case not found.', 404);
  const notes = body.notes ? String(body.notes).slice(0, 2000) : null;
  const saved = await updateRows('moderation_cases', { id: `eq.${existing.id}` }, {
    status, reviewed_by: user.id, reviewed_at: new Date().toISOString(), ...(notes ? { notes } : {}),
  });
  if (!saved.ok) return safeError('The case could not be updated.', 500);
  // A false positive restores an account that was suspended automatically.
  if (status === 'false_positive' && existing.account_suspended) {
    await insertRows('user_account_status', { user_id: existing.user_id, active: true, reason: 'Moderation false positive, reviewed by super admin', updated_by: user.id, updated_at: new Date().toISOString() }, { upsert: true });
  }
  return Response.json({ ok: true, status });
}
