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

/**
 * Returns { text, note } or null (severe cases, no key, rate limit, the model
 * failed, or the rewrite still is not safe).
 */
export async function suggestSafeAlternative({ text, decision, stage = 'request', kind = 'scene', userId }, { fetchImpl = fetch, apiKey = process.env.OPENAI_API_KEY, check = moderate, timeoutMs = 15_000 } = {}) {
  if (!text || !String(text).trim() || decision?.severe || !apiKey) return null;
  if (userId && !allowed(userId)) return null;
  try {
    const res = await fetchImpl('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: REWRITE_MODEL,
        input: [{ role: 'user', content: rewriteBrief({ text, labels: decision?.labels, stage, kind }) }],
        max_output_tokens: 1500,
        ...(REWRITE_MODEL.startsWith('gpt-5') ? { reasoning: { effort: 'minimal' } } : {}),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const out = (data.output_text || (data.output || []).flatMap((o) => o.content || []).map((c) => c.text || '').join('')).trim().replace(/^"|"$/g, '');
    if (!out || out.length < 8) return null;
    const verdict = await check({ text: out });
    if (!verdict.allowed) return null;
    return {
      text: out.slice(0, 5000),
      note: stage === 'result'
        ? 'Same scene, with wardrobe and framing spelled out so the picture stays within our rules.'
        : 'Same scene and mood, reworded to stay within our rules.',
    };
  } catch {
    return null;
  }
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
