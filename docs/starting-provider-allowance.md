# Starting provider-exposure allowance

The owner may opt into a small provider-exposure allowance before real revenue
exists. This does not grant credits, authorize a generation, or bypass other gates.

## Policy

- With zero trailing 30-day real revenue, the cap is the server-configured allowance,
  defaulting to zero and never exceeding 500 cents ($5 USD).
- With any positive trailing 30-day real revenue, the cap remains
  `Math.round(trailingRevenueCents * 0.35)`. The allowance is ignored, not added or
  used as a minimum.
- All outstanding reserved credits, converted to USD cents by the existing
  accounting, reduce the remaining capacity. This is an outstanding-exposure limit,
  not a lifetime spending budget; settled or released reservations free capacity.
- Requests above remaining capacity are blocked. The existing near-limit queue,
  risk checks, credit requirements, reservations, and idempotency stay unchanged.

## Owner configuration

Set `CINEXVIDEO_STARTING_PROVIDER_ALLOWANCE_CENTS` on the production Railway
`studio` service. Only unsigned decimal integer strings representing safe integers
are accepted: `0` disables; `250` permits up to $2.50; `500` permits up to $5.
Larger valid integers are clamped to 500. Missing, empty, signed, whitespace-padded,
fractional, scientific-notation, malformed, and unsafe-integer values disable it.

The setting is read at server runtime in `loadRuntimeSafetySignals`, then passed
to the shared exposure guard. It is not a `NEXT_PUBLIC_*` variable, build-time
browser configuration, request field, or editable `app_settings` row. The previous
unmerged `provider_exposure_floor` database proposal is not used.

## Rollout and rollback

Merge only after CI passes. Wait for Railway to deploy the merged revision
successfully, then set the production variable to `500` and let the configuration
deployment complete. Confirm health and the deployed revision without starting
a generation. Keep maintenance enabled and Stripe in test mode throughout.

To disable, set the variable to `0` (or remove it) and deploy that configuration.
No migration, secret rotation, payment-mode change, or video generation is needed.
