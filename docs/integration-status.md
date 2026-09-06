# Integration Status

| Integration | Status | Verified evidence | Missing for production |
|---|---|---|---|
| Next.js standalone | VERIFIED_WORKING | `npm run build`; `next.config.mjs` output standalone; Docker build runs build and `node server.js` | Deployment environment verification |
| Google OAuth | BLOCKED_BY_EXTERNAL_CONFIGURATION | Browser client, SSR callback, safe next routing, middleware cookie refresh | Supabase Google provider, Google client credentials, Railway public vars, live callback test |
| Supabase auth | PARTIALLY_IMPLEMENTED | `@supabase/ssr`, server callback, middleware session refresh, protected APIs | Live provider/config verification |
| Supabase projects/scenes | PARTIALLY_IMPLEMENTED | REST helpers, owner/admin checks, migrations/RLS | Music-specific schema, broader normalized project model |
| MuAPI generation | PARTIALLY_IMPLEMENTED | `/api/generate`, `/api/jobs/[requestId]`, secret-side provider call, reservation/release/consume RPC paths | Actual provider cost ingestion, attempts, retry/reconcile, worker operations |
| MuAPI catalog/cost | NOT_IMPLEMENTED | Server adapter/policy primitives only | Verified catalog endpoint, snapshots, TTL, drift ingestion |
| Stripe checkout | PARTIALLY_IMPLEMENTED | Checkout route and Stripe session creation | Actual fee/balance transaction ingestion, full event idempotency, refund/dispute reconciliation |
| Stripe Connect | PARTIALLY_IMPLEMENTED | Connect routes/provider code | Production account/provider verification |
| Uploads/storage | PARTIALLY_IMPLEMENTED | Signed upload/download server helpers and upload APIs | Complete UI flow, authenticated storage operations, retention/scan |
| Exports | PARTIALLY_IMPLEMENTED | Quote/queue route; paid final exports intentionally disabled | Render worker, output delivery, settlement/reconciliation |
| AI Director external API | BLOCKED_BY_EXTERNAL_CONFIGURATION | `/api/director` server route requiring `OPENAI_API_KEY` | Provider key/model availability and response persistence |
| AI Director demo | MOCK_OR_DEMO_ONLY | Deterministic writing engine/assistant/progress window | Real authorized model integration |
| Music transcription/alignment | NOT_IMPLEMENTED | Local lyric draft/timing only | Server job/provider/word timestamps |
| Music stems | NOT_IMPLEMENTED | No real stem service | Authenticated provider adapter |
| Vision continuity QA | NOT_IMPLEMENTED | Deterministic declared-state Guardian only | Server vision/clip QA provider |
| Admin economics | PARTIALLY_IMPLEMENTED | Protected cockpit, policy/math modules, unavailable states, cron placeholders | Real data ingestion and scheduler deployment |
| Observability | PARTIALLY_IMPLEMENTED | Health endpoint and console errors | Structured logs, metrics, alerts, traces, reconciliation monitoring |
