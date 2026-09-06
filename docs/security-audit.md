# Security Audit

## Positive Controls Verified

- No service-role key appears in browser helpers; service role is used only in server helpers/webhook paths.
- Production `/dashboard` and `/create` are middleware-protected when demo mode is off.
- Project detail and scene APIs verify owner/admin server-side.
- Admin APIs use `guard()` with admin/super-admin checks.
- OAuth callback uses server-side Supabase SSR cookies and safe internal next-path validation.
- Demo mode is disabled whenever `NODE_ENV=production` and does not call protected/provider APIs.
- Stripe webhook signature verification exists through `constructWebhookEvent`.
- Customer-facing billing route does not accept client-selected pack pricing; it loads active pack data server-side.
- Changed files in this audit contain no secret values or tokens.

## Risks/Gaps

| Risk | Status | Impact | Required action |
|---|---|---|---|
| OAuth provider configuration | BLOCKED_BY_EXTERNAL_CONFIGURATION | Sign-in cannot be verified live | Configure/test Supabase Google provider and Railway vars |
| Stripe webhook idempotency | PARTIALLY_IMPLEMENTED | Duplicate webhook credit grants possible unless DB constraints/RPC guarantee it | Add event-id idempotency table/unique key and test replay |
| Stripe actual fees | NOT_IMPLEMENTED | Contribution margin cannot be actual | Ingest balance transactions/fees |
| MuAPI actual cost | NOT_IMPLEMENTED | Provider cost and margin cannot be actual | Normalize cost per job attempt |
| Generation attempts | NOT_IMPLEMENTED | Retry/failure economics incomplete | Add job_attempts/provider outcome records |
| Economics admin data | PARTIALLY_IMPLEMENTED | Cockpit is truthful but unavailable | Add server-side aggregation queries and freshness records |
| Cron scheduler | BLOCKED_BY_EXTERNAL_CONFIGURATION | Reconciliation does not run automatically | Configure CRON_SECRET/host scheduler/locking |
| Rate limiting | NOT_IMPLEMENTED | Auth/API/provider abuse risk | Add per-user/IP route limits and provider quotas |
| Audit event standardization | PARTIALLY_IMPLEMENTED | Admin financial changes lack unified immutable audit trail | Add audit_events with actor/action/policy version |
| Storage/reference access | PARTIALLY_IMPLEMENTED | Reference asset governance incomplete | Add ownership/versioning/signed scoped provider access |
| Client-only demo storage | ACCEPTED BY DESIGN | Not production user data; local-only | Ensure production flag cannot enable it |

## Secret Scan

Static scans over source/config changed by feature branches found no credential values, tokens, service-role values, Stripe secrets, or provider keys. Variable names are present where server configuration requires them; values are not committed.

## Launch Blockers

Do not enable real paid generation or claim live profitability until provider-cost ingestion, Stripe fee/reconciliation, idempotent settlement, rate limiting, audit records, and staging acceptance tests are complete.
