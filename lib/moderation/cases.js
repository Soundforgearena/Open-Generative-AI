// Moderation cases: the private review queue only the super admin sees.
//
// Every block becomes a case. Media that was made and then withheld (a still
// or a take) is copied into quarantine/<owner>/<case id> in R2 so it can be
// reviewed and, for child-safety cases, preserved as evidence as the law
// requires (Canada: S.C. 2011, c. 4; US: 18 U.S.C. 2258A). The bucket has no
// expiry rule on quarantine/, so nothing is lost before review.

import { archiveMedia } from '../storage/media.js';
import { recordModeration } from './moderate.js';

export const CASE_KINDS = ['prompt', 'photo', 'still', 'take', 'director'];
export const CASE_STATUSES = ['open', 'confirmed', 'false_positive', 'reported'];

export function quarantineKey(ownerId, caseId) {
  const seg = (v) => String(v || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'unknown';
  return `quarantine/${seg(ownerId)}/${seg(caseId)}`;
}

/** Suspend an account pending review (child-safety flags only). */
export function suspender({ insertRows }) {
  return (userId, reason) => insertRows('user_account_status', {
    user_id: userId, active: false, reason, updated_at: new Date().toISOString(),
  }, { upsert: true });
}

/**
 * Log a block (or an unchecked request), open a case, and quarantine any
 * media. Never throws: moderation bookkeeping must not break the request.
 */
export async function handleModeration(decision, { userId, kind, where, projectId = null, sceneId = null, prompt = null, mediaUrl = null }, deps) {
  try {
    await recordModeration(decision, { userId, where, insertRows: deps.insertRows, suspendUser: suspender(deps) });
    if (decision.allowed) return null;
    const row = await deps.insertRows('moderation_cases', {
      user_id: userId,
      project_id: projectId,
      scene_id: sceneId,
      kind: CASE_KINDS.includes(kind) ? kind : 'prompt',
      where_checked: String(where || '').slice(0, 60),
      categories: decision.categories,
      scores: decision.top,
      severe: Boolean(decision.severe),
      account_suspended: Boolean(decision.suspend),
      prompt_excerpt: prompt ? String(prompt).slice(0, 1000) : null,
      status: 'open',
    });
    const id = row?.data?.[0]?.id || null;
    if (id && mediaUrl && /^https:\/\//i.test(mediaUrl)) {
      const copy = (async () => {
        const res = await archiveMedia(mediaUrl, quarantineKey(userId, id), { fetchImpl: deps.fetchImpl, env: deps.env });
        await deps.updateRows('moderation_cases', { id: `eq.${id}` }, res.ok
          ? { media_ref: res.ref, media_sha256: res.sha256, media_bytes: res.bytes }
          : { notes: `quarantine copy failed: ${res.reason}` });
      })().catch((e) => console.error('quarantine failed', e?.message));
      if (deps.awaitMedia) await copy;
    }
    return id;
  } catch (error) {
    console.error('moderation case failed', error?.message);
    return null;
  }
}
