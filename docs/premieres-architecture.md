# CineX Premieres and Creator Vault (coming soon)

Public streaming page for AI-made series and music videos, plus paid creator storage. Everything is shown as **coming soon** until a storage server, safety scanning and an ad server are connected. The admin cockpit's Premieres panel shows the checklist.

## How viewers watch
- **Episodes 1–5 are free** with ads (`FREE_EPISODES` in `lib/premieres/revenue.js`).
- **Episode 6 onward:** the owner sets one unlock price for the rest of the series (50–2,000 credits, steps of 10, suggested 199). Unlocked episodes are ad-free and stay unlocked.
- **Skip ads** on free episodes: 15 credits an episode or 499 credits for a 30-day pass.
- Likes, shares and plays are counted per series and episode. "Most loved" ranks by `plays/100 + likes×3 + shares×8`, so engagement beats raw views.

## Money
Every dollar from ads, skip-ads purchases and unlocks is split **60% owner / 40% CineXVideo** after payment fees (`splitRevenue`, creator rounded down). Payouts through Stripe Connect.

## Where ads go (`adBreaksForEpisode`)
- One 15 s pre-roll on free episodes.
- 30 s mid-rolls only at a **scene cut** from the studio timeline, at least 4 minutes apart, at most 3, never in the last 60 s.
- None for unlocked episodes or skip-ads viewers. Family-safe ad categories only.
- Any VAST/VMAP ad server (Google Ad Manager + IMA SDK recommended). Hookup: `ADS_VAST_TAG_URL`.

## Safety
Policy at `/content-policy` (draft for legal review); rules in `lib/premieres/content-policy.js`. Nothing goes public unless scanned and under strict thresholds; anything flagged waits for a human. Possible minors with any sexual signal: reject, preserve, report (NCMEC / Cybertip.ca), close account. One appeal per rejection; three strikes close a channel. Scanning hookup: `MODERATION_PROVIDER` (sightengine, hive, rekognition) + keys.

## Storage hookup
`lib/storage/provider.js` works with any S3-compatible server (Cloudflare R2 recommended: no bandwidth fees for viewers). Set `STORAGE_S3_ENDPOINT`, `STORAGE_S3_BUCKET`, `STORAGE_S3_ACCESS_KEY_ID`, `STORAGE_S3_SECRET_ACCESS_KEY` (optional `STORAGE_S3_REGION`, `STORAGE_PUBLIC_BASE_URL`) in Railway, then press **Test storage server** in the admin cockpit. Uploads and playback use presigned URLs, so video never passes through the app server. Plans: Starter 25 GB $2.99, Creator 100 GB $7.99, Studio 500 GB $24.99, Network 2 TB $79.99.

## Future tables
`series` (owner, unlock_credits, status), `episodes` (number, duration, scene_cuts, moderation_status), `episode_likes` (unique user+episode), `episode_shares`, `series_unlocks`, `moderation_reviews`, `strikes`, `appeals`, `storage_subscriptions` (plan, quota_bytes, used_bytes), `ad_impressions`, `skip_purchases`, `creator_payouts`. Today only `premiere_waitlist` exists.
