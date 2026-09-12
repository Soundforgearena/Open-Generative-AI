# CineXVideo backend configuration checklist

Every variable below is read by code that is already deployed. This list was
produced by auditing every `process.env` reference in the repository against
the Dockerfile build arguments, so it is the complete set — nothing else is
read at build or request time.

Secrets are never committed. They are set on the Railway service only.

## How to read this

- **Blocking** — the feature returns an error or refuses to run without it.
- **Build-time** — a `NEXT_PUBLIC_*` value. Next inlines these into the browser
  bundle during `npm run build`, so a Railway variable change does nothing
  until the service is redeployed. The Dockerfile declares each one as an
  `ARG`; a value that is not declared there can never reach the browser.

---

## 1. Site and access

| Variable | Blocking | Build-time | What breaks without it |
|---|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | No | Yes | OAuth callback origin, Stripe checkout return URLs and Connect return URLs fall back to the request origin |
| `NEXT_PUBLIC_APP_URL` | No | Yes | Last-resort fallback for Connect return URLs |
| `CINEXVIDEO_MAINTENANCE_MODE` | No | No | Forces the under-construction gate on when `true`. The database toggle in `/admin` is the normal control; this variable overrides it |
| `NEXT_PUBLIC_DEMO_MODE` | No | Yes | Demo mode is off in production regardless, because it is disabled when `NODE_ENV=production` |

## 2. Supabase — authentication, credits, admin

| Variable | Blocking | Build-time | What breaks without it |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | **Yes** | Yes | No sign-in at all; middleware cannot refresh sessions |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | **Yes** | Yes | No sign-in at all |
| `SUPABASE_SERVICE_ROLE_KEY` | **Yes** | No | Every authenticated API route throws `SUPABASE_SERVICE_ROLE_KEY is not configured`; the Stripe webhook cannot grant credits |

Status: configured in production — sign-in, admin access and the maintenance
toggle all work.

## 3. Generation providers

| Variable | Blocking | Build-time | What breaks without it |
|---|---|---|---|
| `MUAPI_API_KEY` | **Yes** | No | `/api/generate`, `/api/jobs/[requestId]` and the reconcile cron all fail. **No video or image can be produced.** |
| `MUAPI_BASE_URL` | No | No | Defaults to `https://api.muapi.ai` |
| `OPENAI_API_KEY` | **Yes** for Director | No | AI Director returns a configuration error |
| `OPENAI_DIRECTOR_MODEL` | No | No | Defaults to `gpt-5` |

Status: `OPENAI_API_KEY` is configured — the Director returns real drafts in
production. `MUAPI_API_KEY` has never been confirmed, and no end-to-end
generation has ever succeeded on this deployment. **This is the single largest
remaining gap.**

Note: `scripts/test_minimax_provider.js` reads `MUAPI_KEY` (no `API`). That is
a standalone smoke-test script only; the application uses `MUAPI_API_KEY`.

## 4. Payments

| Variable | Blocking | Build-time | What breaks without it |
|---|---|---|---|
| `STRIPE_SECRET_KEY` | **Yes** | No | No checkout, no Connect, no payouts; readiness reports `MISSING` |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | No | **Yes** for browser-only Stripe features | Optional today because checkout redirects to a server-created Stripe hosted URL |
| `STRIPE_WEBHOOK_SECRET` *or* `CINEXVIDEO_STRIPE_WEBHOOK_SECRET` | **Yes** | No | Webhook signature verification throws, so **purchased credits are never granted** |
| `APP_URL` | No | No | Only used to display the expected webhook URL. Falls back to `NEXT_PUBLIC_SITE_URL`, then `NEXT_PUBLIC_APP_URL` |
| `STRIPE_LIVE_MODE` | No | No | A live Stripe account is deliberately blocked unless this is exactly `true` |
| `STRIPE_CURRENCY` | No | No | Defaults to `usd` |
| `STRIPE_PARTNER_COUNTRY` | No | No | Defaults to `US` |

Status: `STRIPE_SECRET_KEY` is configured. Hosted checkout does not require a
browser publishable key, so payments are blocked only by the server key,
webhook secret, app URL, and Stripe account readiness checks.

### Order of operations for enabling payments

1. Create the webhook endpoint in the Stripe Dashboard pointing at
   `https://cinexvideo.app/api/billing/webhook`, then set its signing secret.
2. Reload `/admin/stripe-readiness` and confirm every required card reads
   Configured and the account shows charges enabled and details submitted.
3. If browser-side Stripe features are introduced later, set
   `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` in the same mode (test or live) as
   `STRIPE_SECRET_KEY` and redeploy so the bundle picks it up.
4. Only then, when using live keys, set `STRIPE_LIVE_MODE=true`.

Readiness never confirms webhook *delivery* — verify recent successful
deliveries in the Stripe Dashboard before trusting it.

## 5. Operations

| Variable | Blocking | Build-time | What breaks without it |
|---|---|---|---|
| `CRON_SECRET` | **Yes** for crons | No | Every admin cron route rejects with 401 |
| `ENABLE_PAID_EXPORTS` | No | No | No longer required for launch; exports now deliver generated manifests/artifacts directly |

---

## Known limitations, not configuration problems

- `video-editing-basic` is active and customer-visible, but quote generation
  rejects it because its projected margin is below the floor. Video-editing
  paths therefore error with "This creative setup is temporarily unavailable."
  This is a pricing-data issue, not a missing variable.
- There is no GitHub Actions workflow and no `railway.json` in the repository.
  Railway builds from `main` using the Dockerfile; deployment settings live
  only in the Railway dashboard.
