# CINEXVIDEO Master Roadmap

Order is dependency-driven. No workstream may claim completion from UI alone.

## 0. Stabilization and Route/CTA Fixes

**Entry:** current branch audit complete.

**Tasks:**
- Generate route/CTA inventory in CI.
- Remove or disable every dead-end CTA.
- Add route smoke tests for all App Router pages.
- Separate demo-only routes/state from production API paths.
- Fix status-copy truthfulness: no “saved,” “generated,” “exported,” or “charged” without a verified result.
- Add structured error/loading/empty states.

**Definition of done:** all active CTAs have valid destinations/actions; no active placeholder copy; route/build/lint/test checks pass.

**Do not deploy before:** protected routes, auth redirects, and demo production-disable tests pass.

## 1. Shared Project/Data/Authorization Foundation

**Depends on:** 0.

**Tasks:**
- Normalize project, episode, music-video-project, scene, shot, asset, reference, job, attempt, retake, export, and audit entities.
- Add server-only ownership helpers and consistent project/scene authorization.
- Add RLS policies and ownership tests for every persisted entity.
- Make demo stores versioned/local-only and impossible in production.
- Add request idempotency and structured server errors.

**Definition of done:** a real authenticated project can be created/read/updated only by its owner/admin; demo data never crosses the production boundary.

**External requirements:** Supabase migrations/RLS review and production auth configuration.

## 2. Director/MAESTRO/Continuity Foundation

**Depends on:** 1.

**Tasks:**
- Consolidate AI Director writing assistant and Director treatment contracts.
- Add the persistent MAESTRO/Baton model and project-scoped state.
- Persist Continuity Bible, scene entry/exit state, reference metadata, and generation packets.
- Add continuity validation before generation and after completed shots.
- Add controlled suggestion application, undo, audit, and intentional-change reasons.

**Definition of done:** every generation-ready shot has a visible, editable continuity packet and Guardian status; demo validation is clearly non-vision QA.

## 3. Episode Studio Complete Flow

**Depends on:** 1 and 2.

**Tasks:**
- Complete idea/story/script forms and shared project save.
- Character/location/prop/reference setup.
- Director treatment → scene/shot plan → review → generation request → job polling → version approval.
- Retake inheritance and episode assembly.
- Captions and export job contracts.

**Definition of done:** authenticated episode project works end-to-end with real server persistence; demo journey is separate and fully local.

**Do not deploy before:** actual generation, job, version, and export workers are verified.

## 4. Music Video Studio Complete Flow

**Depends on:** 1 and 2.

**Tasks:**
- Authenticated MP3-first upload/storage with ownership and rights confirmation.
- Server transcription/alignment job and editable confirmation state.
- Stem separation adapter and status model.
- Music Director treatment and beat/lyric-aware storyboard.
- Performance/narrative/abstract/lyric modes.
- Timeline editing, continuity, lip-sync eligibility, retakes, captions, exports.

**Definition of done:** a real authorized track can progress through verified storage, alignment, planning, generation, review, and export without fake completion.

## 5. Provider Adapters and Real Generation

**Depends on:** 3/4.

**Tasks:**
- MuAPI actual cost adapter and catalog snapshots.
- Provider job attempt records and status reconciliation.
- Image/video/lip-sync/reference adapters.
- Retry/failure/quality-rejection outcomes.
- End-frame/reference packet delivery.

**Definition of done:** every provider job has idempotent request/attempt/cost/output records and can be reconciled.

## 6. Credits, Stripe, MuAPI Settlement

**Depends on:** 1 and 5.

**Tasks:**
- Verified Stripe webhook/balance transaction fee ingestion.
- Credit purchase cohort and payment-fee allocation.
- Estimate/reservation/settlement/release with integer cents.
- Actual provider cost and direct-cost allocations.
- Margin floor guard and policy versioning.
- Inline top-up with fresh confirmation after material estimate changes.

**Definition of done:** no charge exceeds confirmed reservation; failures release correctly; historical ledger is immutable; margin is unavailable when required sources are incomplete.

## 7. Admin Profitability Cockpit

**Depends on:** 5 and 6.

**Tasks:**
- Real Supabase finance aggregations and admin-only endpoints.
- Stripe/MuAPI/job reconciliation and freshness records.
- Price drift alerts, package simulation, gateway comparison, retry/failure analytics.
- Admin audit log and policy publication workflow.
- Protected cron routes with locking, backoff, and scheduler deployment.

**Definition of done:** cockpit shows verified/partial/stale/unavailable states with provenance; no sample metrics; every action is authorized and audited.

## 8. Production Hardening and Launch Readiness

**Depends on:** all prior workstreams.

**Tasks:**
- Google OAuth provider verification.
- RLS/security review and penetration checks.
- Rate limits, structured observability, alerting, backups, retention.
- Mobile/accessibility matrix and browser test matrix.
- Staging deployment, secrets, cron, Stripe test/live cutover, provider credentials.
- Incident/runbook and reconciliation procedures.

**Definition of done:** staging and production acceptance matrix passes with real external integrations and no unverified claims.
