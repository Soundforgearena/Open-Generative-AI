import test from 'node:test';
import assert from 'node:assert/strict';
import { splitRevenue, estimateEarnings, CREATOR_SHARE, PLATFORM_SHARE } from '../lib/premieres/revenue.js';
import { moderationDecision, describeModeration, CATEGORIES } from '../lib/premieres/content-policy.js';
import { STORAGE_PLANS, planMargin } from '../lib/storage/plans.js';
import { describeStorage, presignUrl } from '../lib/storage/provider.js';
import { seriesForTab, formatViews } from '../lib/premieres/catalog.js';

test('revenue splits 60/40 to the owner and totals always match', () => {
  assert.equal(CREATOR_SHARE + PLATFORM_SHARE, 1);
  assert.deepEqual(splitRevenue(1000), { net: 1000, creator: 600, platform: 400 });
  const odd = splitRevenue(1001);
  assert.equal(odd.creator + odd.platform, 1001);
  assert.equal(odd.creator, 600);
  assert.deepEqual(splitRevenue(-5), { net: 0, creator: 0, platform: 0 });
  const e = estimateEarnings({ views: 100_000 });
  assert.equal(e.creator + e.platform, e.net);
  assert.ok(e.creator > e.platform);
});

test('anything sexual, nude or suggestive is never auto-published', () => {
  assert.equal(moderationDecision({ nudity: 0.16 }).decision, 'review');
  assert.equal(moderationDecision({ suggestive: 0.25 }).decision, 'review'); // e.g. cleavage-focused shot
  assert.equal(moderationDecision({ sexual: 0.9 }).decision, 'review');
  assert.equal(moderationDecision({ nudity: 0.02, violence: 0.1 }).decision, 'approve');
  assert.equal(moderationDecision({}, { scanned: false }).decision, 'review');
});

test('possible minors with any sexual signal are rejected and reported', () => {
  assert.equal(moderationDecision({ minor: 0.5, suggestive: 0.12 }).decision, 'reject_and_report');
  assert.equal(CATEGORIES.find((c) => c.key === 'csam').action, 'reject_and_report');
});

test('moderation hookup reports names only', () => {
  assert.equal(describeModeration({}).configured, false);
  const s = describeModeration({ MODERATION_PROVIDER: 'sightengine', MODERATION_API_KEY: 'k' });
  assert.deepEqual(s.missing, ['MODERATION_API_SECRET']);
  assert.equal(describeModeration({ MODERATION_PROVIDER: 'hive', MODERATION_API_KEY: 'k' }).configured, true);
});

test('every storage plan stays profitable on Cloudflare R2 pricing', () => {
  for (const plan of STORAGE_PLANS) {
    const m = planMargin(plan, { costPerGbMonthCents: 1.5 });
    assert.ok(m.margin > 0.4, `${plan.code} margin ${m.margin}`);
  }
});

test('storage hookup detects the provider and never leaks secrets', () => {
  assert.equal(describeStorage({}).configured, false);
  const env = { STORAGE_S3_ENDPOINT: 'https://acct.r2.cloudflarestorage.com', STORAGE_S3_BUCKET: 'my-bucket', STORAGE_S3_ACCESS_KEY_ID: 'AKID', STORAGE_S3_SECRET_ACCESS_KEY: 'SECRET' };
  const status = describeStorage(env);
  assert.equal(status.configured, true);
  assert.equal(status.provider, 'Cloudflare R2');
  assert.doesNotMatch(JSON.stringify(status), /SECRET|AKID/);
});

test('presigned URLs match the AWS Signature V4 reference (botocore)', () => {
  const env = { STORAGE_S3_ENDPOINT: 'https://acct.r2.cloudflarestorage.com', STORAGE_S3_BUCKET: 'my-bucket', STORAGE_S3_ACCESS_KEY_ID: 'AKID', STORAGE_S3_SECRET_ACCESS_KEY: 'SECRET' };
  const url = presignUrl('PUT', 'a b/c.txt', { env, now: Date.UTC(2026, 9, 7, 1, 2, 3) });
  assert.match(url, /X-Amz-Signature=f7920d1d96d03cdc40ef2bb4df513077eb46a1f596ef8a49f5fe4d8c9d103caf$/);
});

test('preview feed tabs filter and rank like the real feed', () => {
  assert.ok(seriesForTab('New').every((s) => s.isNew));
  assert.ok(seriesForTab('VIP').every((s) => s.vip));
  const ranked = seriesForTab('Ranking');
  assert.ok(ranked[0].views >= ranked[1].views);
  assert.equal(seriesForTab('Popular', undefined, 'dragon').length, 1);
  assert.equal(formatViews(6_700_000), '6.7M');
  assert.equal(formatViews(180_700), '180.7K');
});

import { FREE_EPISODES, isEpisodeFree, normalizeUnlockPrice, unlockBreakdown, adBreaksForEpisode, describeAds } from '../lib/premieres/revenue.js';
import { mostLoved } from '../lib/premieres/catalog.js';

test('first 5 episodes are free, the rest need the owner-set unlock', () => {
  assert.equal(FREE_EPISODES, 5);
  assert.ok(isEpisodeFree(1) && isEpisodeFree(5));
  assert.ok(!isEpisodeFree(6) && !isEpisodeFree(0));
  assert.equal(normalizeUnlockPrice(5), 50);
  assert.equal(normalizeUnlockPrice(99999), 2000);
  assert.equal(normalizeUnlockPrice(203), 200);
  const b = unlockBreakdown(199);
  assert.equal(b.creator + b.platform, b.net);
  assert.ok(b.creator > b.platform);
});

test('ads only land at scene cuts, spaced out, never at the end or for payers', () => {
  const scenes = [45, 60, 50, 70, 40, 65, 55, 80, 45, 60];
  const breaks = adBreaksForEpisode(scenes);
  assert.equal(breaks[0].type, 'pre-roll');
  const cuts = new Set(scenes.reduce((acc, d) => [...acc, (acc.at(-1) || 0) + d], []));
  const total = scenes.reduce((a, b) => a + b, 0);
  for (const m of breaks.slice(1)) {
    assert.ok(cuts.has(m.at), 'mid-roll at a scene cut');
    assert.ok(total - m.at >= 60);
  }
  for (let i = 2; i < breaks.length; i += 1) assert.ok(breaks[i].at - breaks[i - 1].at >= 240);
  assert.deepEqual(adBreaksForEpisode(scenes, { paid: true }), []);
  assert.deepEqual(adBreaksForEpisode(scenes, { skipAds: true }), []);
  assert.equal(adBreaksForEpisode([30, 40]).length, 1);
  assert.equal(describeAds({}).configured, false);
  assert.equal(describeAds({ ADS_VAST_TAG_URL: 'https://ads.example/vast' }).configured, true);
});

test('most loved ranks by likes and shares, not just plays', () => {
  const top = mostLoved();
  assert.equal(top.length, 6);
  assert.ok(top.every((s, i) => i === 0 || (s.likes * 3 + s.shares * 8 + s.views / 100) <= (top[i - 1].likes * 3 + top[i - 1].shares * 8 + top[i - 1].views / 100)));
});
