# Billing & Finance Audit (Phase 1)

Baseline audit of existing billing/credit code before implementing prepaid
credit reservations, Stripe webhook hardening, and MuAPI settlement. No new
code was written until this was recorded.

## Stripe integration (`lib/stripe-connect.js`, `app/api/billing/*`)

- `stripeEnabled()` / lazy `getStripe()` proxy: **VERIFIED_WORKING**. Builds
  cleanly with no key configured; never instantiates Stripe at module scope.
- `createCheckoutSession()`: **VERIFIED_WORKING**. Price/credits always read
  from the `credit_packs` DB row server-side; client only supplies `pack_code`.
- `constructWebhookEvent()`: **VERIFIED_WORKING** signature verification via
  `stripe.webhooks.constructEvent`, but the route that calls it has gaps below.
- Connect Express payouts (`createExpressAccount`, `createTransfer`, etc.):
  **VERIFIED_WORKING**, transfers are idempotent per `payoutId`.

### `app/api/billing/webhook/route.js` — gaps found

1. **No idempotency on Stripe event ID.** A retried `checkout.session.completed`
   delivery re-inserts a `payment_records` row and re-runs
   `credit_wallets_add_purchase` + a ledger insert with no check against
   `event.id`, so a Stripe retry (which *will* happen — Stripe retries on any
   non-2xx or timeout) can double-credit a wallet. **This is the highest
   severity gap.**
2. **Missing event types.** Only `checkout.session.completed`,
   `account.updated`, `account.onboarding_finished` are handled. There is no
   handling for `payment_intent.payment_failed`, `charge.refunded`,
   `charge.dispute.created`, `charge.dispute.closed` — refunds/chargebacks
   never adjust the wallet or flag the account.
3. **No persisted raw event log.** If handler logic changes later, there is no
   way to replay past events, and partial failures (e.g. wallet RPC succeeds,
   ledger insert throws) are not recoverable/auditable.
4. **No dispute/chargeback risk response.** Nothing marks an account
   suspicious or blocks further spend after a chargeback.

### `app/api/billing/checkout/route.js` — status

**VERIFIED_WORKING** as a customer-safe checkout initiator. No changes needed
for Phase 1; new estimate/reservation endpoints sit in front of generation,
not in front of checkout.

## Credit ledger / wallet (Supabase migrations)

- `credit_wallets` (balance, lifetime_consumed), `credit_ledger` (append-only,
  `entry_type` constrained to `grant|purchase|reservation|release|consumption
  |refund|adjustment`), `credit_reservations` (referenced by
  `consume_credits()` but its `CREATE TABLE` was not found in any migration in
  this repo — **NOT_IMPLEMENTED**, only referenced/assumed by
  `consume_credits()`'s `update ... where generation_job_id::text = ...`).
- `reserve_credits()`, `fulfil_credit_purchase()`, `settle_generation_revenue()`
  RPCs are referenced by comments/UI but their `CREATE FUNCTION` bodies are
  **not present in any committed migration** — they were applied directly to
  the live Supabase project and never captured in this repo. **Gap: schema is
  not fully reproducible from source control.**
- No `payment_fee_records`, `provider_cost_records`, `financial_audit_events`,
  `pricing_policy_versions`, `data_source_sync_runs` tables exist anywhere.

## Economics engine (`lib/billing/*.js`, from `feature/cinexvideo-admin-profitability-cockpit`)

All pure, synchronous, in-memory functions — **no side effects, no DB calls**:

- `margin-policy.js`: versioned policy constants (67.5% target / 65% floor / 70% cap).
- `cost-model.js`, `estimate-engine.js`: build a loaded-cost estimate and
  required customer credits from a caller-supplied MuAPI cost estimate.
- `reservation-engine.js` / `settlement-engine.js`: pure state-transition
  helpers (`reserveCredits`, `settleReservation`, `releaseReservation`) that
  operate on a plain object passed in by the caller — **they do not read or
  write any database**. Nothing calls them from a live route today.
- `profitability-guard.js`: `assertMinimumMargin` / `validatePackageEconomics`
  — also pure, unused by any live route.
- `lib/providers/muapi-cost-adapter.js`, `muapi-price-catalog.js`: normalize a
  MuAPI response and cache it in an in-memory (non-persistent) TTL map. Not
  wired into any generation endpoint.

**Conclusion: the math is correct and tested, but nothing in the request path
(checkout → estimate → reserve → generate → settle) is connected end-to-end.**
This audit's job is to wire these pure functions into real persisted
reservations without weakening the existing margin/idempotency guarantees.

## Summary of Phase-1 required work

| Gap | Severity | Plan |
|---|---|---|
| Stripe webhook not idempotent on event ID | Critical | Add `stripe_events` table + idempotency check before handling |
| No refund/dispute handling in webhook | High | Add `charge.refunded`, `payment_intent.payment_failed`, `charge.dispute.created/closed` cases |
| `credit_reservations` table not in repo migrations | High | Add migration defining the table (additive, does not touch live schema assumptions) |
| No estimate/reservation/job-start API surface | High | Add `POST /api/billing/estimate`, `POST /api/billing/reservations`, `POST /api/billing/reservations/:id/cancel`, `POST /api/jobs/start` |
| No provider-exposure / risk guard | Medium | Add `lib/billing/provider-exposure-guard.js`, `lib/billing/risk-policy.js` |
| No fee ingestion / chargeback handling module | Medium | Add `lib/billing/fee-allocation.js`, `lib/billing/chargeback-handler.js` |
