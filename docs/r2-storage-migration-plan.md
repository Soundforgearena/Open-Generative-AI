# Cloudflare R2 storage migration plan

Status: **plan only**. No bucket, DNS, cache, SSL/security setting or user media has been created, changed or migrated by this document. No secrets are committed.

## 1. What exists today (inspected)

| Area | Current behaviour | Source |
| --- | --- | --- |
| Reference/audio bucket | Supabase Storage bucket `cinexvideo-references`, `public = false`, owner RLS policy `cinex_refs_owner` | `supabase/migrations/20260903_cinexvideo_creative_schema.sql` (bucket section) |
| Bucket limits | 60 MB (`62914560`) and an image/audio MIME allow-list; the API applies a stricter 15 MB cap to images | `supabase/migrations/20260907123000_reference_bucket_upload_limits.sql`, `lib/upload-validation.js` |
| Metadata | `public.project_assets` (`project_id`, `kind`, `name`, `notes`, `storage_path`, `locked`) | creative schema migration |
| Key convention | `<user_id>/<project_id>/<Date.now()>-<sanitised filename>` | `app/api/uploads/route.js` |
| Upload flow | `POST /api/uploads` validates, enforces 30 files/project and `UPLOAD_QUOTA_MB` (default 500) per user, inserts the `project_assets` row, returns a signed upload URL; the browser then `PUT`s the file | `app/api/uploads/route.js`, `lib/cinexvideo-client.js` (`uploadReference`) |
| Download flow | Short-lived signed GET URLs (`createSignedDownloadUrl`, default 900 s) are returned by `GET /api/projects/[id]` as `preview_url` and used by the renderer for the soundtrack (3600 s) | `app/api/projects/[id]/route.js`, `app/api/exports/video/route.js` |
| Delete | `DELETE /api/uploads?asset_id=` removes the object then the row | `app/api/uploads/route.js` |
| Server helpers | `createSignedUploadUrl`, `createSignedDownloadUrl`, `deleteStorageObject` call the Supabase Storage REST API with the service role key | `lib/cinexvideo-server.js` |
| Quota | `storage_used_bytes(uuid)` sums `storage.objects.metadata->>'size'` for `cinexvideo-references` | `supabase/migrations/20261006210000_scale_indexes.sql` |
| Finished videos | **Not stored.** Renders stream to the client and are saved to device/Drive/Dropbox (`/api/exports` is retired) | `app/api/exports/route.js`, `lib/exports/render-video.js` |
| Generated takes | `scene_versions.output_url` points at provider (MuAPI) URLs; not copied into app storage | `app/api/jobs/[requestId]/route.js` |
| Existing S3 adapter | `lib/storage/provider.js`: SigV4 presigned `PUT`/`GET`/`DELETE`, path-style URLs, `describeStorage()` and an admin "Test storage server" button (`/api/admin/storage`). Used by the Premieres/Creator Vault plans, **not** by references | `lib/storage/provider.js`, `app/api/admin/storage/route.js`, `docs/premieres-architecture.md` |
| Env | `STORAGE_S3_ENDPOINT`, `STORAGE_S3_BUCKET`, `STORAGE_S3_ACCESS_KEY_ID`, `STORAGE_S3_SECRET_ACCESS_KEY`, optional `STORAGE_S3_REGION` (default `auto`) and `STORAGE_PUBLIC_BASE_URL`. Supabase: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. `UPLOAD_QUOTA_MB` | `docs/backend-configuration-checklist.md`, `Dockerfile`, `README.md` |
| Deployment | Railway (Dockerfile). `NEXT_PUBLIC_*` values are build args. CSP is set in `middleware.js` | `Dockerfile`, `middleware.js` |

## 2. Defects/gaps that block a straight swap

These are why no code switch is included in this pass.

1. **CSP `connect-src`** in `middleware.js` allows only `self`, MuAPI, Google, Dropbox and the Supabase origin. Browser `PUT`s to an R2 presigned URL would be blocked. The R2 S3 origin (`https://<account>.r2.cloudflarestorage.com`, or the custom upload hostname) must be added, derived from `STORAGE_S3_ENDPOINT`.
2. **Quota RPC** `storage_used_bytes` reads `storage.objects`, which will not see R2 objects. Quota enforcement needs a `size_bytes` column on `project_assets` (backfilled from `storage.objects.metadata->>'size'`) or an S3 list call. Billing/credit tables are unaffected.
3. **No server-side content validation on R2.** Supabase enforces `file_size_limit` and `allowed_mime_types` at the bucket. A presigned R2 `PUT` does not. The signer must bind `Content-Type` and `Content-Length` (sign these headers) and `POST /api/uploads` must reject anything above its existing caps; a post-upload `HEAD` check should confirm size and type before the asset is returned as ready.
4. **`provider.js` signs only `host`.** For references it must also sign `content-type` (and ideally `content-length`) so the stored object matches what the API validated. It also lacks `HEAD`/`COPY`/list helpers needed by backfill.
5. **`storage_path` has no backend marker.** During migration both backends coexist, so each row needs to say where its bytes live (see §5).

## 3. Target design

### Buckets (to be created by an operator later, not in this pass)

| Bucket | Purpose | Access |
| --- | --- | --- |
| `cinexvideo-references-prod` | Reference images and soundtrack uploads (replaces Supabase `cinexvideo-references`) | Private. No public access, no custom domain, no `r2.dev` URL |
| `cinexvideo-references-staging` | Same, for staging/tests | Private |
| `cinexvideo-vault-prod` | Creator Vault / Premieres (already supported by `provider.js`) | Private; published episodes served through a CDN domain only (`STORAGE_PUBLIC_BASE_URL`) |

### Key convention

```
refs/<user_id>/<project_id>/<asset_id>-<sanitised filename>
```

* Uses the `project_assets.id` UUID instead of `Date.now()` so keys are unique and idempotent for backfill.
* Keeps the `<user_id>/` prefix so per-user listing, quota and deletion stay prefix-based.
* Filename sanitisation is unchanged (`[^a-zA-Z0-9._-]` -> `_`, last 80 chars).
* Legacy Supabase keys (`<user_id>/<project_id>/<ts>-<name>`) are preserved during migration and copied 1:1 under the `refs/` prefix (see §5).
* Reserved prefixes: `_cinex-healthcheck/` (admin connection test; lifecycle-expire after 1 day).

### Private-by-default signed URL flow

1. Browser calls `POST /api/uploads` (unchanged contract: returns `upload_url`, `content_type`, `asset`).
2. Server validates (existing `validateUploadDetails`, file/quota caps), inserts `project_assets`, and signs an R2 `PUT` for the key with `X-Amz-Expires=300`, signed headers `host;content-type` (+ `content-length`).
3. Browser `PUT`s directly to R2 (no bytes through Railway).
4. Reads: `GET /api/projects/[id]` and the renderer call a server-side `signGet(key, 900|3600)`. URLs are never stored in the database and never logged.
5. Delete: server-side signed `DELETE` (or S3 `DeleteObject`) before the row is removed, as today.

Signed URL TTLs: upload 300 s, preview 900 s, renderer soundtrack 3600 s, maximum 3600 s. Ownership is always checked in the API (`project.owner_id === user.id` or admin) before signing. R2 has no RLS; the API is the only authority.

### Adapter shape (implementation-ready)

Add `lib/storage/object-store.js` exporting the same three function names already used by routes, selected by `STORAGE_BACKEND` (`supabase` default, `r2`):

```
createSignedUploadUrl(bucket, key, { contentType, sizeBytes })
createSignedDownloadUrl(bucket, key, expiresIn)
deleteStorageObject(bucket, key)
```

* `supabase` backend: delegates to the current functions in `lib/cinexvideo-server.js` (no behaviour change).
* `r2` backend: uses `presignUrl` from `lib/storage/provider.js`, extended to sign `content-type`/`content-length`.
* Routes switch per row using `project_assets.storage_backend` (§5), so reads work for both backends during migration.
* Unit tests: SigV4 deterministic vector, TTL clamp, key sanitisation, no secret in URL, backend routing by row.

### CORS (R2 bucket policy, set by operator)

```json
[{
  "AllowedOrigins": ["https://<production-app-domain>"],
  "AllowedMethods": ["PUT", "GET", "HEAD"],
  "AllowedHeaders": ["content-type", "content-length"],
  "ExposeHeaders": ["etag"],
  "MaxAgeSeconds": 3600
}]
```

Staging uses its own origin. Never `*`. Also add the R2 origin to `connect-src` in `middleware.js` (§2.1).

### Lifecycle / retention

* Abort incomplete multipart uploads after 1 day.
* `_cinex-healthcheck/` expires after 1 day.
* Reference objects: no automatic expiry. Deleted when the user deletes the asset or project, or when an account is erased. The DB row is the source of truth; run a weekly orphan report (objects with no `project_assets` row older than 7 days) and delete only after manual review.
* Cloudflare R2 object versioning is not available; keep the Supabase bucket and its objects untouched (never deleted) until the §5 step 7 deletion is approved, no sooner than 30 days after the last Supabase read. That is the rollback guarantee window.

## 4. Required secrets / configuration (names only)

Set in Railway (never in git):

* `STORAGE_BACKEND` (`supabase` until cut-over, then `r2`)
* `STORAGE_S3_ENDPOINT` (`https://<account-id>.r2.cloudflarestorage.com`)
* `STORAGE_S3_BUCKET` (`cinexvideo-references-prod`)
* `STORAGE_S3_ACCESS_KEY_ID`, `STORAGE_S3_SECRET_ACCESS_KEY` (R2 API token scoped to Object Read & Write on that bucket only)
* `STORAGE_S3_REGION` (`auto`)
* `STORAGE_PUBLIC_BASE_URL` only for the vault CDN domain, never for the references bucket
* Backfill job only: reuses the existing `SUPABASE_SERVICE_ROLE_KEY` (full privilege; Supabase has no read-only storage key). Run the job from a one-off Railway service so the key is not widened, and keep the job read-only by code (GET only against Supabase).

Separate R2 API tokens for prod, staging and the backfill job, so the backfill token can be revoked afterwards.

## 5. Migration / backfill

Prerequisite migration (not applied here), additive and reversible:

```sql
alter table public.project_assets
  add column if not exists storage_backend text not null default 'supabase'
    check (storage_backend in ('supabase','r2')),
  add column if not exists size_bytes bigint,
  add column if not exists content_type text;
```

Steps:

1. Operator creates the private bucket, scoped tokens and CORS (outside this PR). Run **Test storage server** in the admin cockpit.
2. Deploy code with `STORAGE_BACKEND=supabase` (no behaviour change). Ship the CSP change and the new columns.
3. Backfill `size_bytes`/`content_type` from `storage.objects` metadata.
4. Backfill job (resumable, idempotent, rate-limited, dry-run first): for each `project_assets` row with `storage_backend='supabase'` and a `storage_path`, create a short-lived Supabase signed GET, stream it to R2 `PutObject` at the same key under `refs/`, `HEAD` to verify size (and ETag/checksum where available), then record the new state in a side table `storage_migration_log(asset_id, status, bytes, error, at)`. The row is flipped to `storage_backend='r2'` and `storage_path='refs/…'` only after verification. Failures are retried, never deleted.
5. Flip `STORAGE_BACKEND=r2` for **new** uploads once ≥ 99.9 % of rows verify. Reads keep following the per-row backend.
6. Reconcile: counts and byte totals per user, Supabase vs R2, must match. Smoke test: upload, preview, delete, render with a soundtrack.
7. Only after 30 consecutive days with no Supabase reads **and** explicit approval, delete the old Supabase objects. Until then rollback (§6) is always available.

## 6. Rollback

* Before step 5: nothing user-facing changed; set `STORAGE_BACKEND=supabase` / drop the new columns.
* After step 5: set `STORAGE_BACKEND=supabase`. New uploads go to Supabase again. Rows already flipped to `r2` keep reading from R2 (no data lost); to move them back, run the backfill in reverse (R2 -> Supabase) using `storage_migration_log`.
* Supabase objects and policies stay untouched until the §5 step 7 deletion is approved, so any row can be pointed back by resetting `storage_backend='supabase'` with its original `storage_path` (kept in `storage_migration_log`).
* Revert the CSP change only if no R2 uploads remain.

## 7. Explicitly out of scope in this pass

Creating buckets/tokens, DNS, cache purge, SSL/security settings, CORS application, migrating any user media, applying migrations, changing billing or database contracts, and flipping any runtime backend.

## 8. Unresolved prerequisites (need an owner)

1. Cloudflare account/zone owner creates the buckets and API tokens (§3, §4).
2. Decide the production app origin(s) for CORS and CSP.
3. Approve the `project_assets` additive migration and `storage_migration_log` table.
4. Decide retention for deleted-account media (legal/privacy review).
5. Confirm per-user quota semantics after the quota RPC is replaced (`size_bytes`-based).
6. Provide a staging bucket to run the SigV4 + CORS end-to-end test, which cannot be done from this repository's tests.
