# CineXVideo Cloudflare R2 admin connection

The normal setup is Admin → Settings → Cloudflare R2: enter **R2 Access Key ID** and **R2 Secret Access Key**, then select **Connect Cloudflare R2**. The account endpoint and private bucket are pre-bound for this deployment; users do not need to edit Railway variables or bucket CORS for ordinary transfers.

## What was missing

The previous app contained an environment-variable readiness panel and an R2 migration plan, but no admin credential form. Reference and soundtrack uploads still used Supabase Storage. This change adds the real connection workflow and routes new reference/soundtrack uploads through private R2 storage.

## Connection behavior

- **Two-field default:** Account `64897aa07bba43a38a79a7f17201340f`, bucket `cinexvideo-vault`, region `auto`. An optional collapsed Advanced panel supports an existing bucket or jurisdiction before the first connection.
- **Verification:** The server writes a uniquely named tiny health-check object, reads the exact content back and removes that same object. A failed write, read or cleanup does not save or replace the connection.
- **Private bucket creation:** If the named bucket is absent, the app attempts to create it privately. Keys without bucket-management permission need the displayed bucket to exist already; the UI explains this rather than pretending that two arbitrary keys can access or create any bucket.
- **Key security:** Only a super admin can submit or rotate credentials. Both fields are masked and cleared after an attempt. AES-256-GCM encrypts the keys, with account/bucket binding authenticated as associated data. Status responses expose only a four-character key hint and safe connection metadata.
- **Rotation:** New keys must pass verification before replacing the previous credentials. Conditional persistence rejects overlapping updates. Changing account/bucket after connection is blocked to prevent old media from becoming inaccessible.
- **No browser CORS setup:** Authenticated, same-origin application endpoints stream uploads and serve short-lived authorized reads. R2 keys and S3 write URLs are not returned to the browser.

Cloudflare requires a separately identified account endpoint and valid bucket permissions; those facts cannot be recovered from an arbitrary access-key pair alone. This deployment pre-binds the account and default bucket so the normal form can stay at two fields ([Cloudflare credential guidance](https://developers.cloudflare.com/r2/api/tokens/), [S3 compatibility](https://developers.cloudflare.com/r2/api/s3/api/)).

## Media behavior and limits

- **New writes:** Reference images and uploaded audio go to `refs/<owner>/<project>/<asset>` in the private R2 bucket. New writes fail closed when R2 is not connected; they do not silently fall back to Supabase.
- **Existing assets:** Existing Supabase objects and paths remain untouched. Legacy reads and deletes remain available through their original backend.
- **Ownership:** Reads, uploads and deletes validate the owner/project/asset namespace, not merely a caller-supplied object path. Short-lived read tokens bind the exact path and expiration.
- **Quotas:** A server-only database function serializes reservations per owner. Pending transfers count toward the 30-file project cap and the configured per-user byte limit; existing Supabase bytes are included.
- **Byte limits:** The proxy counts actual streamed bytes and rejects both oversized and truncated uploads. Images retain the 15 MiB limit; audio retains the 60 MiB limit.
- **Commit behavior:** Metadata becomes `ready` only after storage accepts the bytes. Failed transfers are cleaned up where possible and remain retryable; a completed upload cannot overwrite its object.
- **Deletion:** Object deletion precedes metadata removal. A failed storage deletion retains the record for retry rather than losing track of billable objects.
- **Exports:** Finished-video rendering can read a soundtrack from either R2 or legacy Supabase. Server-side renderer reads use private, short-lived R2 URLs.

This release does not backfill existing files, automatically archive provider-generated takes, persist completed exported videos, enable public premieres, configure a CDN, or delete old Supabase media. Those are separate media-lifecycle workflows; saving two credentials does not implement them by itself.

## One-time deployment prerequisites

1. Apply `20261012010000_r2_reference_uploads.sql` before deploying the new upload routes. It adds storage backend/size/type/state metadata, a server-only quota reservation function, and restrictions on direct client table writes.
2. Generate a fresh 32-byte random encryption key, encode it as 64 hexadecimal characters, and configure `STORAGE_CREDENTIALS_ENCRYPTION_KEY` server-side. This is deployment work, not a third field the admin must enter.
3. Preserve the encryption key in the deployment secret store. Rotating it without re-encrypting the saved connection will make the credentials unreadable.
4. Merge the reviewed PR and verify production sign-in, super-admin access and the two-field form.
5. The owner enters the actual R2 key pair in the authenticated production form. Its verification call is the first real R2 connection test; mocked tests are not evidence that the owner's keys work.
6. After connection, upload a small reference and audio file, preview them, render an export with the soundtrack, and delete only the test media.

There is no need to change DNS, expose `r2.dev`, make a bucket public, change Stripe mode, or disable maintenance. The account/bucket/jurisdiction are non-secret defaults; the R2 access and secret keys belong only in the authenticated admin form.

## Validation and known boundaries

Local validation: 280 automated tests passed, 33 browser/API checks passed, the production Next.js build passed, lint reported no errors, and the production dependency audit reported zero vulnerabilities. The four storage-settings browser checks were also rerun against the final production stylesheet.

Unit and executable route tests cover encryption/tampering, safe status serialization, permissions, failed key rotation, connection cleanup, URL signing, token expiry, namespace isolation, exact byte limits, duplicate writes and client upload authorization. An isolated PostgreSQL-compatible test applies the migration twice and verifies quota, owner, file-count and privilege restrictions.

Browser tests exercise the actual settings component with synthetic keys and mocked responses. They verify the two-field flow, masked/cleared inputs, no browser credential persistence, failure feedback, super-admin gating, missing-encryption gating and mobile layout. Production API guards remain separately tested; no unauthenticated test route is shipped.

Actual Cloudflare credentials were not supplied to this build session. No real R2 bucket was created, no customer object was uploaded/deleted, and no live connection success is claimed before the owner completes the production form.

## Recovery

- **Failed key verification:** The previous encrypted connection remains intact.
- **Interrupted uploads:** Incomplete metadata continues consuming quota until retried or reconciled. An upload interrupted by server termination can remain `uploading`; inspect its object and active request before changing state. Do not drop reservations or delete objects blindly.
- **Account erasure:** Raw client project deletion is disabled to avoid cascading metadata while orphaning media. Administrative account erasure still needs an explicit storage-cleanup workflow; this release does not claim to implement one.
- **Rollback:** Keep the additive columns and encrypted connection. Do not roll back blindly to a revision that treats every `storage_path` as a Supabase key once R2 assets exist. Preserve the dual-read code or restore it first; never delete source media as a rollback shortcut.
