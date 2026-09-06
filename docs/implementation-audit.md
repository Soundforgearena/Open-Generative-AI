# CINEXVIDEO Master Implementation Audit

Audit baseline: branch `feature/cinexvideo-admin-profitability-cockpit`, commit `bc75570`, inspected 2026-09-06. This audit evaluates end-to-end behavior, not route/file existence.

## Executive Summary

CINEXVIDEO is a Next.js App Router application packaged as a standalone Next server. The repository contains a substantial responsive shell, Google-only auth implementation, protected REST-style Supabase APIs, local-only demo creation/storyboard workflows, Music Video planning screens, Continuity Guardian primitives, and a truthful-but-mostly-unavailable admin economics cockpit.

The product is **not production-ready as a complete creation platform**. Real external integrations are incomplete or unverified: Google provider setup is external, MuAPI actual-cost ingestion is absent, payment fee/balance reconciliation is absent, real uploads/transcription/stems/video generation/export are incomplete, and demo routes must remain separate from production APIs.

## Status Vocabulary

`VERIFIED_WORKING` means source, route, validation, and a complete local/secure path were verified. `MOCK_OR_DEMO_ONLY` means the local path works but makes no production claim. `PARTIALLY_IMPLEMENTED` means meaningful code exists but at least one required end-to-end dependency is missing. `BLOCKED_BY_EXTERNAL_CONFIGURATION` means the code path exists but cannot be verified without a provider/account/configuration. `BROKEN` means a route/action fails or has a confirmed defect. `UI_ONLY` means visible UI lacks a working save/action path. `BACKEND_ONLY` means an API exists without an equivalent user journey. `NOT_IMPLEMENTED` means no credible implementation was found.

## Product Scope Matrix

| Area | Status | Evidence | Exact gap | Priority |
|---|---|---|---|---|
| Landing/navigation/responsive shell | VERIFIED_WORKING | `app/page.js`, `components/CinexNavigation.js`, `app/globals.css`; build/lint pass | Browser screenshot matrix was not available in container; image warnings remain | P1 |
| Google OAuth UI/callback/session | BLOCKED_BY_EXTERNAL_CONFIGURATION | `app/auth/page.js`, `app/auth/callback/route.js`, `lib/supabase-browser.js`, `middleware.js` | Provider dashboard/Railway runtime values were not verifiable locally | P0 |
| Demo mode safety | VERIFIED_WORKING | `lib/demo-mode.js`, middleware, local stores, tests | Needs deployment policy/preview environment enforcement outside code | P0 |
| Episode idea/story/script local planning | MOCK_OR_DEMO_ONLY | `/create`, `/create/story`, `/create/script`, `DemoProjectBuilder`, `lib/storyboard.js` | No real provider-backed generation; local draft is not a production project unless authenticated API succeeds | P1 |
| Episode review/editor | MOCK_OR_DEMO_ONLY | `/create/review`, `/create/project/[id]`, demo store | Production scene persistence/editor coverage is partial; continuity is declared-state validation, not vision QA | P1 |
| Music Video Studio | MOCK_OR_DEMO_ONLY | `/music-video/*`, `lib/music-video-demo.js`, `lib/music-video-director.js` | No authenticated audio upload, transcription/alignment, stems, provider generation, or export | P1 |
| AI Director writing assistant | MOCK_OR_DEMO_ONLY | `AskAiDirectorButton`, `AiDirectorAssistant`, `lib/ai-director-writing.js` | Local deterministic suggestions only; `/api/director` is separate and external-dependent | P1 |
| MAESTRO/Baton persistent co-pilot | NOT_IMPLEMENTED | No active route/component with this product role | No persistent cross-project co-pilot state or workflow | P2 |
| Continuity Bible/Guardian | PARTIALLY_IMPLEMENTED | `lib/continuity/*`, `components/continuity/*`, review integration | Declared metadata validator only; no reference binary storage, post-generation visual QA, or retake inheritance | P1 |
| Real generation | PARTIALLY_IMPLEMENTED | `/api/generate`, `/api/jobs/[requestId]`, Supabase schema | Actual provider cost capture/settlement and operational worker reconciliation are incomplete | P0 |
| Credits/Stripe checkout | PARTIALLY_IMPLEMENTED | `/api/billing/checkout`, `/api/billing/webhook`, migrations, `lib/stripe-connect.js` | Webhook paths are not proven idempotent for all events; actual Stripe fee/balance transaction ingestion absent | P0 |
| 65–70% pricing engine | PARTIALLY_IMPLEMENTED | `lib/billing/*`, `/admin/cockpit`, `/admin/economics` | Math/tests exist; real source data, reservation integration, settlement integration, and publication/audit persistence absent | P0 |
| Admin cockpit | PARTIALLY_IMPLEMENTED | `/admin/*`, `lib/admin/*`, `EconomicsDashboard` | Server-gated truthful empty/unavailable console; no real finance aggregation/sync tables/jobs | P0 |
| Image/Cinema Studio | UI_ONLY / NOT_IMPLEMENTED | Vite/Electron components under `src/components` | Not exposed as coherent Next App Router product routes with project ownership/review flow | P2 |
| Retakes/versioning | PARTIALLY_IMPLEMENTED | `scene_versions`, generation route, scene PATCH | Provider result/version path exists; product retake rules, cost policy, UI, and continuity inheritance incomplete | P1 |
| Captions/exports | PARTIALLY_IMPLEMENTED | `/api/exports`, `export_jobs` references | Paid exports intentionally disabled; no render worker/delivery proof | P1 |
| Legal pages | VERIFIED_WORKING | `/privacy`, `/terms`, `/refunds` | Legal content/product claims require review before launch | P2 |
| Observability/rate limits | NOT_IMPLEMENTED | Some console logging and health endpoint | No consistent structured events, rate limits, alerting, or audit pipeline | P0 |

## Major Findings

1. The public Next app is the active product (`npm run build`; Docker standalone `node server.js`). Vite/Electron `src/` and `components/cinex/*` are separate targets and are not the deployed Next `/auth` route.
2. Demo mode is explicit and production-disabled in `lib/demo-mode.js`; its local stores do not call protected APIs. This is the safest currently usable end-to-end path.
3. Real generation reserves credits through Supabase RPCs and calls MuAPI, but `generation_requests` does not contain a normalized provider-cost record or attempt table. The code settles reserved credits based on polling status, not actual provider cost.
4. The admin economics cockpit is intentionally truthful but largely unavailable: it currently reports missing verified sources instead of fabricating financial metrics. It must not be described as a live profitability dashboard until ingestion exists.
5. The current schema has `projects`, `scenes`, `scene_versions`, `project_assets`, `generation_requests`, credit wallets/reservations/ledger, payment records, revenue records, and admin members, but lacks normalized provider costs, attempts, pricing policies, estimates, retakes, exports provenance, sync runs, and audit economics records.

## Safe Immediate Decision

Do not merge the current feature stack as “production-complete.” Merge only after the P0 workstream gates in `docs/master-roadmap.md` are met and live sources are verified.
