// CineX Premieres content safety rules.
//
// Strict by design: anything that could be sexual, nude or suggestive never
// goes public automatically. Every upload is scanned; the slightest signal
// holds it for a trained human reviewer who accepts or rejects it. Content
// involving minors in any sexual context is rejected, preserved and reported.

export const POLICY_VERSION = '2026-10-draft-1';

export const CATEGORIES = [
  { key: 'csam', label: 'Any sexual or sexualised content involving minors', action: 'reject_and_report', note: 'Zero tolerance. Removed immediately, account terminated, evidence preserved and reported to the relevant authorities (for example NCMEC in the US and the Canadian Centre for Child Protection in Canada).' },
  { key: 'nudity', label: 'Nudity, including partial nudity and visible private parts', action: 'reject' },
  { key: 'sexual', label: 'Sexual activity, sexual acts or sexually explicit content', action: 'reject' },
  { key: 'suggestive', label: 'Suggestive or revealing content: cleavage-focused shots, see-through clothing, lingerie, sexualised poses or camera angles', action: 'review' },
  { key: 'violence', label: 'Graphic violence, gore, self-harm or cruelty', action: 'review' },
  { key: 'hate', label: 'Hate speech, harassment or extremist content', action: 'reject' },
  { key: 'illegal', label: 'Illegal goods, dangerous acts or content that breaks local law', action: 'reject' },
  { key: 'deepfake', label: 'Realistic depictions of real people without their consent, or impersonation', action: 'review' },
  { key: 'ip', label: 'Music, footage or characters you do not have the rights to', action: 'review' },
];

// Classifier scores are 0..1. Thresholds are deliberately low: we would rather
// a human looks at a hundred safe videos than let one unsafe video through.
export const THRESHOLDS = {
  minor: 0.2,
  nudity: 0.15,
  sexual: 0.15,
  suggestive: 0.2,
  violence: 0.35,
  hate: 0.3,
};

/**
 * Decide what happens to an upload from automated scan scores.
 * Returns { decision: 'reject_and_report' | 'review' | 'approve', reasons }.
 * Nothing is ever auto-rejected for sexual content without a human, except
 * where minors may be involved; it is held for review instead.
 */
export function moderationDecision(scores = {}, { scanned = true } = {}) {
  const s = (k) => Number(scores[k]) || 0;
  const reasons = [];
  if (!scanned) return { decision: 'review', reasons: ['not_scanned'] };
  const sexualSignal = Math.max(s('nudity'), s('sexual'), s('suggestive'));
  if (s('minor') >= THRESHOLDS.minor && sexualSignal >= 0.1) {
    return { decision: 'reject_and_report', reasons: ['minor_sexual_risk'] };
  }
  for (const key of ['nudity', 'sexual', 'suggestive', 'violence', 'hate']) {
    if (s(key) >= THRESHOLDS[key]) reasons.push(key);
  }
  return reasons.length ? { decision: 'review', reasons } : { decision: 'approve', reasons: [] };
}

/** Final states a reviewer can choose, each with a statement of reasons. */
export const REVIEW_OUTCOMES = [
  { key: 'accepted', label: 'Accept and publish' },
  { key: 'accepted_restricted', label: 'Accept for adults only (18+, age-verified viewers)' },
  { key: 'rejected', label: 'Reject with reason (creator can appeal once)' },
  { key: 'rejected_strike', label: 'Reject and add a strike (3 strikes closes the channel)' },
];

/**
 * Automated scanning hookup. Any one of these services can supply the scores
 * moderationDecision() needs. Presence-only: never returns a secret.
 *   MODERATION_PROVIDER = sightengine | hive | rekognition
 *   MODERATION_API_KEY (+ MODERATION_API_SECRET for Sightengine)
 */
export function describeModeration(env = {}) {
  const provider = String(env.MODERATION_PROVIDER || '').toLowerCase();
  const known = ['sightengine', 'hive', 'rekognition'];
  const needs = provider === 'sightengine' ? ['MODERATION_API_KEY', 'MODERATION_API_SECRET'] : ['MODERATION_API_KEY'];
  const missing = ['MODERATION_PROVIDER', ...needs].filter((k) => !(typeof env[k] === 'string' && env[k].trim()));
  return { configured: known.includes(provider) && missing.length === 0, provider: known.includes(provider) ? provider : null, missing };
}
