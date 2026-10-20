// When something is blocked, offer the user a safe alternative instead of a
// dead end. The alternative keeps the scene's story, mood and emotion but
// stays inside /content-policy, and is itself moderated before it is offered.
// It is free to the user (a tiny model call the platform covers), and
// rate-limited per user.

import { moderate } from './moderate.js';

export const REWRITE_MODEL = process.env.OPENAI_SAFE_REWRITE_MODEL || 'gpt-5-mini';
const RATE = new Map(); // user id -> timestamps
const LIMIT_PER_HOUR = 20;

const RULES = [
  'Everyone is an adult and fully clothed in non-revealing clothing. No nudity, no lingerie-only outfits, no sexual acts, poses or camera angles.',
  'No hate, slurs or threats against any person or group.',
  'No graphic gore: violence may be implied, stylised or happen off camera.',
  'No self-harm instructions or encouragement.',
].join(' ');

function allowed(userId, now = Date.now()) {
  const list = (RATE.get(userId) || []).filter((t) => now - t < 3_600_000);
  if (list.length >= LIMIT_PER_HOUR) return false;
  list.push(now);
  RATE.set(userId, list);
  return true;
}

/** The instruction for the rewrite. Exported for tests. */
export function rewriteBrief({ text, labels = [], stage = 'request', kind = 'scene' }) {
  const why = labels.length ? labels.join(', ') : 'content our rules do not allow';
  const what = kind === 'director' ? 'creative brief for an AI music video or episode director' : 'scene description for an AI music video or episode';
  return [
    `Rewrite this ${what} so it can be made on CineXVideo.`,
    stage === 'result'
      ? `The description was allowed, but the picture it produced was flagged for ${why}. Rewrite it so the picture is clearly safe: describe modest wardrobe, safe framing and staging explicitly.`
      : `It was blocked for ${why}.`,
    `Rules: ${RULES}`,
    'Keep everything else: the people, place, story, mood, emotion, energy, camera style and any words on signs. Keep it about the same length, written as the user would write it, in the same language.',
    'Return only the rewritten description, no quotes and no explanation.',
    '',
    String(text || '').slice(0, 2400),
  ].join('\n');
}

const REFUSAL = /^(i\s*(can(no|')t|cannot|am unable|won't)|sorry|i'm sorry|as an ai)/i;
const FALLBACK_MODEL = process.env.OPENAI_DIRECTOR_MODEL || 'gpt-5';

function outputText(data) {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) return data.output_text;
  return (data?.output || [])
    .filter((o) => o.type === 'message' || Array.isArray(o.content))
    .flatMap((o) => o.content || [])
    .map((c) => (typeof c.text === 'string' ? c.text : ''))
    .join('');
}

async function rewriteOnce({ prompt, model, fetchImpl, apiKey, timeoutMs }) {
  const res = await fetchImpl('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      input: [{ role: 'user', content: prompt }],
      max_output_tokens: 2000,
      ...(model.startsWith('gpt-5') ? { reasoning: { effort: 'low' } } : {}),
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) return { reason: `http_${res.status}` };
  const data = await res.json();
  const text = outputText(data).trim().replace(/^["“]|["”]$/g, '');
  if (!text || text.length < 8) return { reason: data?.status === 'incomplete' ? 'incomplete' : 'empty' };
  if (REFUSAL.test(text)) return { reason: 'refused' };
  return { text };
}

/**
 * Returns { text, note } or null (severe cases, no key, rate limit, the model
 * failed, or the rewrite still is not safe). Tries twice: the second attempt
 * is stricter. onResult(reason) reports what happened, for the admin log.
 */
export async function suggestSafeAlternative({ text, decision, stage = 'request', kind = 'scene', userId }, { fetchImpl = fetch, apiKey = process.env.OPENAI_API_KEY, check = moderate, timeoutMs = 20_000, onResult = null, insertRows = null, models = [REWRITE_MODEL, FALLBACK_MODEL] } = {}) {
  const report = (reason) => {
    try { onResult?.(reason); } catch { /* ignore */ }
    if (insertRows) {
      Promise.resolve(insertRows('admin_metric_events', { event_type: 'moderation_alternative', operation: kind, model: REWRITE_MODEL, user_id: userId || null, status: String(reason).slice(0, 80), metadata: { stage } })).catch(() => {});
    }
  };
  if (!text || !String(text).trim()) { report('no_text'); return null; }
  if (decision?.severe) { report('severe'); return null; }
  if (!apiKey) { report('no_key'); return null; }
  if (userId && !allowed(userId)) { report('rate_limited'); return null; }
  const base = rewriteBrief({ text, labels: decision?.labels, stage, kind });
  const strict = `${base}\n\nImportant: the result must be clearly non-sexual and non-violent. Remove anything seductive, sultry, intimate or revealing (beds, undressing, lingerie, bodies as the focus) and anything gory or hateful. Put the focus on the place, the action and the feeling.`;
  const reasons = [];
  let model = models[0];
  for (const prompt of [base, strict]) {
    try {
      let out = await rewriteOnce({ prompt, model, fetchImpl, apiKey, timeoutMs });
      if (out.reason?.startsWith('http_4') && models[1] && model !== models[1]) {
        model = models[1];
        out = await rewriteOnce({ prompt, model, fetchImpl, apiKey, timeoutMs });
      }
      if (!out.text) { reasons.push(out.reason); continue; }
      const verdict = await check({ text: out.text });
      if (!verdict.allowed) { reasons.push('still_blocked'); continue; }
      report(reasons.length ? `ok_after_${reasons.join('+')}` : 'ok');
      return {
        text: out.text.slice(0, 5000),
        note: stage === 'result'
          ? 'Same scene, with wardrobe and framing spelled out so the picture stays within our rules.'
          : 'Same scene and mood, reworded to stay within our rules.',
      };
    } catch (error) {
      reasons.push(error?.name === 'TimeoutError' ? 'timeout' : 'error');
    }
  }
  report(reasons.join('+') || 'failed');
  return null;
}

/** Shape of every blocked response the app sends. */
export function blockedPayload({ message, decision, alternative = null, stage = 'request', target = 'prompt', sceneId = null, field = null }) {
  return {
    error: message,
    blocked: true,
    policy: '/content-policy',
    block: {
      stage, // 'request' (nothing made, nothing charged) or 'result' (made, withheld, refunded)
      target, // 'prompt' | 'photo' | 'director'
      reasons: decision?.labels || [],
      severe: Boolean(decision?.severe),
      scene_id: sceneId,
      field, // director: which field the alternative replaces
      alternative,
    },
  };
}
