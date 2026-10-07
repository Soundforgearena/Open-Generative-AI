// CineX Premieres revenue rules (future state).
//
// Every dollar a series earns, from ads or from viewers paying to skip ads,
// is split 60% to the series owner and 40% to CineXVideo, after payment and
// ad-network fees. The split lives here so the public page, the creator
// dashboard and payouts can never disagree.

export const CREATOR_SHARE = 0.6;
export const PLATFORM_SHARE = 0.4;

/** Skip ads on one episode, or every episode for 30 days. 1 credit = $0.01. */
export const SKIP_ADS_OPTIONS = [
  { code: 'episode', label: 'Skip ads on this episode', credits: 15 },
  { code: 'pass_30d', label: 'Ad-free pass, 30 days', credits: 499 },
];

/** Split net revenue (cents, after fees). The creator's 60% is rounded down; the remainder goes to the platform so totals always match exactly. */
export function splitRevenue(netCents) {
  const net = Math.max(0, Math.floor(Number(netCents) || 0));
  const creator = Math.floor(net * CREATOR_SHARE);
  return { net, creator, platform: net - creator };
}

/**
 * Rough monthly earnings preview for the public calculator.
 * `rpmCents` is net ad revenue per 1,000 ad-supported views; `skipRate` is
 * the share of viewers who pay to skip ads on an episode.
 */
export function estimateEarnings({ views, rpmCents = 400, skipRate = 0.03, skipCredits = SKIP_ADS_OPTIONS[0].credits, feeRate = 0.08 }) {
  const v = Math.max(0, Math.floor(Number(views) || 0));
  const skippers = Math.floor(v * skipRate);
  const adCents = ((v - skippers) / 1000) * rpmCents;
  const skipCents = skippers * skipCredits * (1 - feeRate);
  const split = splitRevenue(adCents + skipCents);
  return { views: v, skippers, adCents: Math.floor(adCents), skipCents: Math.floor(skipCents), ...split };
}

/* ------------------------------------------------ episodes and unlocks */

/** Episodes 1-5 of every series are free to watch (with ads). */
export const FREE_EPISODES = 5;

/** Owners choose the price to unlock the rest of a series, within these limits. */
export const UNLOCK_PRICE_LIMITS = { min: 50, max: 2000, step: 10, suggested: 199 };

export function isEpisodeFree(episodeNumber) {
  return Number(episodeNumber) >= 1 && Number(episodeNumber) <= FREE_EPISODES;
}

/** Clamp an owner's chosen unlock price to the allowed range and step. */
export function normalizeUnlockPrice(credits) {
  const { min, max, step } = UNLOCK_PRICE_LIMITS;
  const n = Math.round((Number(credits) || 0) / step) * step;
  return Math.min(max, Math.max(min, n));
}

/** What a viewer pays and who receives it when unlocking a series. */
export function unlockBreakdown(credits, { feeRate = 0.08 } = {}) {
  const price = normalizeUnlockPrice(credits);
  const net = Math.floor(price * (1 - feeRate));
  return { price, ...splitRevenue(net) };
}

/* ----------------------------------------------------------------- ads */

/**
 * Where ads go in an episode. Rules that keep viewers watching:
 * - Paid (unlocked) episodes and skip-ads viewers never see ads.
 * - Free episodes get one short pre-roll.
 * - Episodes longer than 4 minutes may get mid-rolls, but ONLY at a scene
 *   cut from the studio timeline (never mid-shot), at least 4 minutes apart,
 *   and never in the last 60 seconds.
 * `sceneDurations` are seconds, in order. Returns ad break times in seconds.
 */
export const AD_RULES = { preRollSeconds: 15, midRollSeconds: 30, minGapSeconds: 240, noAdsInLastSeconds: 60, maxMidRolls: 3 };

export function adBreaksForEpisode(sceneDurations = [], { paid = false, skipAds = false, rules = AD_RULES } = {}) {
  if (paid || skipAds) return [];
  const breaks = [{ at: 0, type: 'pre-roll', seconds: rules.preRollSeconds }];
  const total = sceneDurations.reduce((sum, d) => sum + (Number(d) || 0), 0);
  let t = 0;
  let last = 0;
  for (let i = 0; i < sceneDurations.length - 1; i += 1) {
    t += Number(sceneDurations[i]) || 0;
    const mids = breaks.length - 1;
    if (mids >= rules.maxMidRolls) break;
    if (t - last >= rules.minGapSeconds && total - t >= rules.noAdsInLastSeconds) {
      breaks.push({ at: t, type: 'mid-roll', seconds: rules.midRollSeconds, afterScene: i + 1 });
      last = t;
    }
  }
  return breaks;
}

/**
 * Ad server hookup. Any VAST/VMAP-compatible ad server works (Google Ad
 * Manager with the IMA SDK, Freewheel, SpringServe...). Set ADS_VAST_TAG_URL
 * in Railway when an ad account is approved. Presence-only.
 */
export function describeAds(env = {}) {
  const set = typeof env.ADS_VAST_TAG_URL === 'string' && env.ADS_VAST_TAG_URL.startsWith('https://');
  return { configured: set, missing: set ? [] : ['ADS_VAST_TAG_URL'] };
}
