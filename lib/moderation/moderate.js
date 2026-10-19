// Content moderation for everything users ask CineXVideo to make.
//
// Uses OpenAI's moderation model (omni-moderation-latest), which is free and
// checks both text and images. It runs before anything is charged:
//   - every still and video prompt, and every AI Director request (text)
//   - the real-face photo behind a still (image)
//   - every generated still before the user sees it (image)
// Rules follow /content-policy and /terms. Fictional action, drama and strong
// emotion are allowed; sexual content, child sexualisation, hate, threats,
// self-harm instructions and graphic gore are not.

export const MODERATION_MODEL = 'omni-moderation-latest';
export const MODERATION_POLICY_VERSION = '2026-10-19-v1';

// Hard limits. sexual/minors uses a low score so near-misses are blocked too.
const BLOCK = [
  { key: 'sexual/minors', score: 0.2, label: 'sexual content involving minors', severe: true },
  { key: 'sexual', score: 0.3, label: 'sexual or nude content' },
  { key: 'hate', score: 0.5, label: 'hate speech' },
  { key: 'hate/threatening', score: 0.4, label: 'hateful threats' },
  { key: 'harassment/threatening', score: 0.5, label: 'threats against a person' },
  { key: 'self-harm/intent', score: 0.5, label: 'self-harm' },
  { key: 'self-harm/instructions', score: 0.4, label: 'self-harm instructions' },
  { key: 'illicit/violent', score: 0.6, label: 'instructions for violent crime' },
  // Action and fight scenes are fine; only graphic gore is blocked.
  { key: 'violence/graphic', score: 0.85, label: 'graphic gore' },
];

export class ContentBlockedError extends Error {
  constructor(decision) {
    super(`content blocked: ${decision.labels.join(', ')}`);
    this.name = 'ContentBlockedError';
    this.decision = decision;
  }
}

/** Turn one moderation result into allow / block, with readable reasons. */
export function decide(result) {
  const scores = result?.category_scores || {};
  const flagged = result?.categories || {};
  const hits = BLOCK.filter((r) => Number(scores[r.key]) >= r.score || (r.severe && flagged[r.key] === true));
  return {
    allowed: hits.length === 0,
    severe: hits.some((h) => h.severe),
    // Account is suspended only when OpenAI itself flags child sexualisation.
    suspend: flagged['sexual/minors'] === true,
    categories: hits.map((h) => h.key),
    labels: hits.map((h) => h.label),
    top: Object.fromEntries(hits.map((h) => [h.key, Math.round(Number(scores[h.key]) * 1000) / 1000])),
  };
}

/** Combine several results (text + images): blocked if any part is blocked. */
export function decideAll(results = []) {
  const parts = results.map(decide);
  const categories = [...new Set(parts.flatMap((p) => p.categories))];
  return {
    allowed: parts.every((p) => p.allowed),
    severe: parts.some((p) => p.severe),
    suspend: parts.some((p) => p.suspend),
    categories,
    labels: [...new Set(parts.flatMap((p) => p.labels))],
    top: Object.assign({}, ...parts.map((p) => p.top)),
  };
}

/**
 * Song lyrics quoted inside a scene prompt are not checked as text: explicit
 * lyrics are allowed in a song, but the pictures are not. The still and every
 * take are still checked as images.
 */
export function stripLyricQuotes(text = '') {
  return String(text || '').replace(/singing the words "[^"]*"/gi, 'singing the lyrics');
}

/** What the user is told. Never echoes the scores. */
export function blockedMessage(decision, { charged = false } = {}) {
  const what = decision.labels.length ? decision.labels.join(', ') : 'content our rules do not allow';
  const money = charged ? 'Your credits were returned.' : 'Nothing was charged.';
  return `This can't be made on CineXVideo because it looks like ${what}. ${money} Please change the description. See our content policy at /content-policy.`;
}

/**
 * Check text and/or images. Returns a decision. If the moderation service is
 * unreachable the request is allowed (fail-open) and `unchecked: true` is set,
 * because the video models run their own safety filters as a second layer.
 */
export async function moderate({ text = '', imageUrls = [] } = {}, { fetchImpl = fetch, apiKey = process.env.OPENAI_API_KEY, timeoutMs = 8000 } = {}) {
  const input = [];
  const cleanText = stripLyricQuotes(text).trim().slice(0, 12000);
  if (cleanText) input.push({ type: 'text', text: cleanText });
  for (const url of imageUrls.filter(Boolean).slice(0, 4)) input.push({ type: 'image_url', image_url: { url } });
  if (!input.length) return { allowed: true, severe: false, suspend: false, categories: [], labels: [], top: {}, skipped: true };
  if (!apiKey) return { allowed: true, severe: false, suspend: false, categories: [], labels: [], top: {}, unchecked: true, reason: 'no_key' };
  try {
    // Images are checked one per request (the API scores one image at a time).
    const texts = input.filter((i) => i.type === 'text');
    const images = input.filter((i) => i.type === 'image_url');
    const batches = images.length ? images.map((img, i) => (i === 0 ? [...texts, img] : [img])) : [texts];
    const results = [];
    for (const batch of batches) {
      const res = await fetchImpl('https://api.openai.com/v1/moderations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODERATION_MODEL, input: batch }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) return { allowed: true, severe: false, suspend: false, categories: [], labels: [], top: {}, unchecked: true, reason: `http_${res.status}` };
      const data = await res.json();
      results.push(...(data?.results || []));
    }
    return decideAll(results);
  } catch (error) {
    return { allowed: true, severe: false, suspend: false, categories: [], labels: [], top: {}, unchecked: true, reason: error?.name === 'TimeoutError' ? 'timeout' : 'error' };
  }
}

/**
 * Record a decision for the super admin (blocked or unchecked only), and
 * suspend the account on a flagged child-safety hit pending human review.
 * deps: { insertRows, updateRows? (unused), upsertStatus }
 */
export async function recordModeration(decision, { userId, where, insertRows, suspendUser = null }) {
  if (decision.allowed && !decision.unchecked) return;
  try {
    await insertRows('admin_metric_events', {
      event_type: decision.allowed ? 'moderation_unchecked' : decision.severe ? 'moderation_blocked_severe' : 'moderation_blocked',
      operation: where,
      user_id: userId,
      status: decision.allowed ? decision.reason || 'unchecked' : decision.categories.join(','),
      metadata: { policy: MODERATION_POLICY_VERSION, categories: decision.categories, scores: decision.top, suspended: Boolean(decision.suspend && suspendUser) },
    });
    if (decision.suspend && suspendUser) await suspendUser(userId, 'Automatic: child-safety moderation flag. Super admin review required.');
  } catch (error) {
    console.error('moderation record failed', error?.message);
  }
}
