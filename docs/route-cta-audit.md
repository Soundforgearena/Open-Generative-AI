# Route and CTA Audit

## Route Inventory

### Public/product routes

| Route | Purpose | Current status | Protected in production? |
|---|---|---|---|
| `/` | Landing/navigation | VERIFIED_WORKING | Public |
| `/auth` | Google-only auth entry | BLOCKED_BY_EXTERNAL_CONFIGURATION | Public |
| `/auth/callback` | OAuth code exchange | PARTIALLY_IMPLEMENTED | Public callback |
| `/create` | Local/demo creation hub | MOCK_OR_DEMO_ONLY | Middleware protects when demo off |
| `/create/story` | Story input | MOCK_OR_DEMO_ONLY | Middleware protects when demo off |
| `/create/script` | Script input | MOCK_OR_DEMO_ONLY | Middleware protects when demo off |
| `/create/review` | Editable local/real review adapter | PARTIALLY_IMPLEMENTED | Middleware protects when demo off |
| `/create/project/[id]` | Local project editor | MOCK_OR_DEMO_ONLY | Middleware protects when demo off |
| `/create/director` | AI Director Writing Room | MOCK_OR_DEMO_ONLY | Middleware protects when demo off |
| `/dashboard` | Local demo/auth project history | PARTIALLY_IMPLEMENTED | Middleware protects when demo off |
| `/templates` | Template catalog | MOCK_OR_DEMO_ONLY | Public/product |
| `/projects/[id]` | Completed demo storyboard | MOCK_OR_DEMO_ONLY | Middleware protects when demo off |
| `/music-video` | Music Video Studio hub | MOCK_OR_DEMO_ONLY | Middleware protects when demo off |
| `/music-video/new` | Music setup/lyrics/direction | MOCK_OR_DEMO_ONLY | Middleware protects when demo off |
| `/music-video/director` | Music treatment | MOCK_OR_DEMO_ONLY | Middleware protects when demo off |
| `/music-video/storyboard` | Beat/lyric storyboard | MOCK_OR_DEMO_ONLY | Middleware protects when demo off |
| `/music-video/review` | Music review/simulation | MOCK_OR_DEMO_ONLY | Middleware protects when demo off |
| `/music-video/projects` | Music demo history | MOCK_OR_DEMO_ONLY | Middleware protects when demo off |
| `/music-video/projects/[id]` | Music demo detail | MOCK_OR_DEMO_ONLY | Middleware protects when demo off |
| `/privacy`, `/terms`, `/refunds` | Legal pages | VERIFIED_WORKING | Public |
| `/under-construction` | Maintenance page | VERIFIED_WORKING | Public allowlist |

### Admin routes

`/admin`, `/admin/cockpit`, `/admin/economics`, `/admin/operations`, `/admin/pricing`, `/admin/data-sources`, `/admin/audit-log`, and `/admin/connect` are intended to be server-authorized. The economics pages use `requireAdmin()`; other admin routes must be separately verified against their API authorization and production data behavior.

### API inventory

Protected API groups include projects, scenes, jobs, generation, uploads, exports, billing, catalog, director, user account, admin actions/partners/payouts/summary, and provider proxy routes. `/api/health` is intentionally public. Admin cron placeholders require `CRON_SECRET` and report unavailable until schedulers are deployed.

## CTA Findings

- Landing Create/Sign-in/Features/template links: real Next links or anchors; responsive menu exists.
- Create hub cards: real route links; local demo builder saves metadata and routes to review.
- Story/script submit: real local demo save or authenticated project API path; loading/validation/error states exist.
- Review Back/Create/Dashboard/Director links: real routes.
- Review simulation: local-only status transition; completed-project link appears only after completion.
- Music setup: demo profiles are functional; upload/import controls are deliberately disabled with integration copy; rights checkbox gates progression.
- Music Director → Storyboard → Review → simulated complete: real local routes/actions.
- Admin cockpit refresh/publish controls: no live mutation action is exposed; unavailable state is truthful.
- Existing Vite/Electron `components/cinex/AuthScreen.js` contains legacy email/create UI but is not imported by the Next App Router. It remains a separate target and should not be mistaken for the deployed route.

## CTA Risks

1. Production real project creation requires auth and backend schema; demo mode is not production access.
2. Real generation/export controls are intentionally unavailable or protected because workers/providers are incomplete.
3. Admin cockpit values are unavailable/partial until ingestion sources exist.
4. No browser screenshot runner is present in the audit container; responsive claims rely on CSS inspection, build, route compilation, and automated tests.
