# Cloudflare R2 storage migration plan

**Status: planning only.** Supabase Storage remains the active and default backend. This plan does not create buckets or tokens, change Cloudflare DNS/SSL/cache/security settings, migrate media, apply schema changes, or alter billing/database contracts.

## Current Supabase Storage behavior

- `cinexvideo-references` is a private Supabase Storage bucket with an owner policy. Bucket limits are 60 MiB and an image/audio MIME allow-list; application validation applies a stricter image cap. See `supabase/migrations/20260903_cinexvideo_creative_schema.sql`, `supabase/migrations/20260907123000_reference_bucket_upload_limits.sql`, and `lib/upload-validation.js`.
- `POST /api/uploads` checks project ownership, upload type/size, a 30-file project limit, and the per-user `UPLOAD_QUOTA_MB` limit (default 500 MiB). It inserts `project_assets` metadata and returns a signed upload URL. The browser uploads directly to Supabase. `DELETE /api/uploads` removes the object and its metadata row.
- Keys currently use `<user_id>/<project_id>/<timestamp>-<sanitised-filename>`. Filenames replace characters outside `[A-Za-z0-9._-]` with `_` and are limited to their last 80 characters. The API uses signed download URLs for project previews; the renderer also obtains signed URLs for audio.
- Upload URLs are created by `createSignedUploadUrl` without an explicit expiry argument, so their lifetime is Supabase-managed. Signed GET URLs default to 900 seconds; the renderer requests a longer-lived signed URL for audio.
- The `storage_used_bytes(uuid)` RPC sums `storage.objects` metadata for `cinexvideo-references`. It cannot account for objects stored outside Supabase. The upload route treats an unavailable quota RPC as zero bytes used, which should be reviewed separately before migration.
- Generated takes remain at provider URLs. Finished videos are streamed to the user or their connected Drive/Dropbox; Studio exports are not persisted in this bucket.
- `lib/storage/provider.js` already implements S3-compatible presigning for separate Vault/Premieres functionality. It is not used by reference uploads. `STORAGE_S3_ENDPOINT` is currently optional configuration, not a storage-backend switch.
- CSP now permits the origin of a configured **HTTPS** `STORAGE_S3_ENDPOINT` in `connect-src`. Supabase remains included and is still the production upload service. R2 bucket CORS must separately allow the exact application origins; CSP does not configure bucket CORS.

## Target R2 design (future, gated on prerequisites)

Create private production and staging reference buckets only after an operator approves the rollout. Use keys in the form:

```text
refs/<user_id>/<project_id>/<asset_id>-<sanitised-filename>
```

Use the `project_assets` UUID for idempotent backfill. Preserve original Supabase keys and record them in the migration log until rollback is no longer required. Do not expose a public bucket or `r2.dev` URL.

Keep the existing API contract: the browser requests an upload from `POST /api/uploads`, then uses a short-lived signed PUT URL; authenticated API routes issue private signed GETs and deletes after checking ownership. Proposed TTLs are 300 seconds for upload, 900 seconds for previews, and up to 3600 seconds for renderer reads. Never store signed URLs in the database or log them.

R2 does not inherit Supabase bucket MIME/size enforcement. Before enabling writes, bind validated content type and size constraints to the signing/upload flow and verify uploaded objects (for example, with a server-side HEAD) before treating metadata as ready. Extend `lib/storage/provider.js` only after a deterministic SigV4/CORS integration test passes.

Configure bucket CORS with exact production or staging origins, only the required PUT/GET/HEAD methods and content headers, and no wildcard origin. The HTTPS endpoint is included in CSP when configured; custom upload domains must also be explicitly represented in CSP and CORS.

## Quotas, lifecycle, and retention

The current quota RPC only counts Supabase `storage.objects`. An R2 migration therefore needs an additive size/content metadata strategy (such as `size_bytes` and `content_type` on `project_assets`) or a separately verified R2 accounting service before quota enforcement can move. Keep existing caps and failure behavior; do not change billing.

No object-expiration policy is configured by the current reference-bucket migrations. `DELETE /api/uploads` removes the stored object when a reference is deleted; confirm account-erasure behavior before migration. For R2, abort incomplete multipart uploads after one day and expire health-check objects after one day. Do not expire user references automatically. Generate a weekly orphan report and require review before deleting any objects. Keep Supabase objects untouched for at least 30 days after the last Supabase read and until explicit approval.

## Dual-read migration and rollout

1. Complete the prerequisites below and prove signing, CORS, upload, preview, deletion, and soundtrack rendering in staging.
2. Add an explicitly approved, additive migration that records each asset's `storage_backend` (default `supabase`), `size_bytes`, and `content_type`, plus a migration log preserving original paths. Do not apply this migration as part of this plan.
3. Deploy code with Supabase as the default. Reads must choose the backend recorded for each asset; new writes remain on Supabase until the backfill and checks pass.
4. Backfill resumably and idempotently: read Supabase objects, copy to the planned R2 key, verify size/checksum, and only then mark the row as R2. Record failures for retry and never delete the source during backfill.
5. Reconcile per-user object counts and byte totals. After at least 99.9% verification and successful end-to-end tests, an operator may enable R2 for new writes while dual-read remains active.
6. Keep Supabase data for rollback. Delete source objects only after 30 consecutive days without Supabase reads and separate explicit approval.

## Rollback

Before R2 writes are enabled, keep the runtime on Supabase and remove only the additive migration if it has been approved and applied. After R2 writes begin, switch new writes back to Supabase while continuing per-row reads from the recorded backend. Restore individual assets from their original Supabase paths using the migration log if needed. Do not delete either copy during rollback; revert the CSP allowance only after no R2 reads or writes remain.

## Prerequisites and explicit exclusions

- An account owner must create private staging/production buckets and narrowly scoped, separate API tokens. No token values belong in source control.
- Confirm production/staging application origins and configure exact bucket CORS rules.
- Approve the additive `project_assets` metadata and migration-log schema, and define quota accounting for both backends.
- Decide deleted-account media retention and assign an owner for orphan reports.
- Run an end-to-end staging SigV4/CORS/upload/read/delete/render test.
- This repository change does not create Cloudflare resources, change Cloudflare DNS, SSL, cache or security settings, migrate media, switch reference storage, apply a migration, or modify billing/database contracts.
