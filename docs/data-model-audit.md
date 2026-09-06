# Data Model Audit

## Existing Tables/Migrations Found

The creative migration defines:

- `projects`: owner, lane (`music_video` or `episode`), title, logline, visual identity, director plan, status.
- `scenes`: project ownership through `project_id`, position, purpose, duration, prompts, status, active version, continuity lock.
- `scene_versions`: versioned prompts/output/status/approval.
- `project_assets`: character/outfit/location/prop/reference/audio metadata and storage path.
- `generation_requests`: user/project/scene/provider/model/operation/provider request ID/reservation/status/output.
- `credit_wallets`, `credit_reservations`, and `credit_ledger`: referenced by migrations/RPCs.
- `payment_records`, `credit_packs`, revenue/partner tables, and admin members/invites exist across later migrations.

RLS evidence exists for projects, scenes, scene versions, assets, and generation requests with owner/admin checks. Server routes also use `guard()` and ownership checks in project/scene detail routes.

## Missing or Incomplete Normalized Entities

| Entity | Current evidence | Status | Gap |
|---|---|---|---|
| users/profiles | Supabase auth/user account references | PARTIALLY_IMPLEMENTED | No consolidated product profile model documented |
| episodes | `projects.lane='episode'` | PARTIALLY_IMPLEMENTED | No dedicated episode entity/assembly model |
| music_video_projects | `projects.lane='music_video'` plus local demo schema | PARTIALLY_IMPLEMENTED | No production music-specific tables |
| scenes/shots | Scenes exist; music storyboard is local JSON | PARTIALLY_IMPLEMENTED | No normalized shot entity for music/timing |
| assets/reference_assets | `project_assets` metadata exists | PARTIALLY_IMPLEMENTED | Private reference versioning and signed-provider delivery not complete |
| continuity_bibles/states | Continuity code is local module/UI | MOCK_OR_DEMO_ONLY | No persisted production tables/RLS |
| jobs/job_attempts | `generation_requests` exists | PARTIALLY_IMPLEMENTED | No normalized attempt/provider-cost records |
| provider_cost_records | No table found | NOT_IMPLEMENTED | Needed for actual MuAPI settlement |
| credit_accounts | `credit_wallets` exists | PARTIALLY_IMPLEMENTED | Cohorts/bonus/liability allocation not modeled |
| ledger_entries | `credit_ledger` exists | PARTIALLY_IMPLEMENTED | Immutable economics/audit dimensions incomplete |
| reservations/estimates | `credit_reservations`, RPC references | PARTIALLY_IMPLEMENTED | Unified estimate version/idempotency model absent |
| pricing_policy_versions | New server-only policy module | MOCK_OR_DEMO_ONLY | No persisted publication/audit table |
| purchases/refunds | `payment_records` and webhook purchase path | PARTIALLY_IMPLEMENTED | Refund/dispute/fee reconciliation incomplete |
| retakes | Scene versions support versioning | PARTIALLY_IMPLEMENTED | No dedicated retake policy/cost/audit model |
| exports | API references `export_jobs` | PARTIALLY_IMPLEMENTED | Render worker/output delivery not present |
| audit events | Admin action/revenue tables exist | PARTIALLY_IMPLEMENTED | No unified audit events for pricing/economics/actions |
| source sync records | None found | NOT_IMPLEMENTED | Required for freshness/reconciliation cockpit |

## Ownership/RLS Risks

- Project and scene routes enforce ownership server-side in application code and migrations.
- Admin APIs use `guard()` role checks.
- The new economics cockpit is server-authorized, but its real data queries are not implemented; it therefore reports unavailable rather than fabricating data.
- Music and demo projects are local-only; they are not Supabase user projects.
- Provider cost, retry, payment-fee, and source-sync tables are missing, so contribution margin cannot be claimed as actual.
