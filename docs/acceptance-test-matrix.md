# Acceptance Test Matrix

| Area | Test | Current result | Required before launch |
|---|---|---|---|
| Build | `npm ci` | Run in prior feature sessions; current audit branch must rerun | Pass |
| Lint | `npm run lint` | Prior branches pass with image warnings | Pass with warnings documented |
| Unit | `npm test` | 37 tests pass on economics baseline | Add route/CTA and audit tests |
| Landing | CTA destinations | Static audit found valid primary routes | Browser matrix |
| Auth | `/auth`/callback | Build and source verified; provider not live-tested | Live Google provider test |
| Demo safety | Production flag cannot enable demo | Automated tests pass | Deploy/preview environment test |
| Story | Submit → review | Local demo path exists | Browser test save/refresh/edit |
| Music | Setup → Director → storyboard → review | Local demo routes compile | Browser test lyrics/rights/timing |
| Continuity | Bible/Guardian warnings | Unit validator tests pass | Persisted production states |
| Generation | Real provider job | API path exists | MuAPI staging job/cost/settlement test |
| Billing | Checkout/webhook | Route exists; actual fee/replay not proven | Stripe test-mode replay tests |
| Admin | Non-admin denied | Server guard code exists | Authenticated role integration test |
| Economics | Empty/unavailable cockpit | Truthful states implemented | Real source ingestion tests |
| Responsive | 320/375/390/768/1024/1366/1440 | CSS/build inspection; no browser renderer available | Playwright/device screenshot matrix |
| Secrets | Changed-file scan | No secret values found | CI secret scanning |
| Cron | Authorization/locking | CRON routes require `CRON_SECRET`; jobs unavailable | Host scheduler deployment and lock tests |

## Manual Journey Matrix

### Local demo mode

1. Set `NEXT_PUBLIC_DEMO_MODE=true` with non-production `NODE_ENV`.
2. Open `/create` and choose idea/story/script/template.
3. Submit a valid draft.
4. Confirm local project ID route to `/create/review`.
5. Edit/reorder/add/delete scenes.
6. Simulate generation; confirm no provider/API call and completed route appears.
7. Open dashboard; confirm local project history and reset confirmation.
8. Open `/music-video`, choose demo track, confirm rights, choose lyrics/instrumental mode.
9. Review Director treatment, storyboard timing/lip-sync state, and review simulation.

### Production-like mode

1. Set `NEXT_PUBLIC_DEMO_MODE=true` with `NODE_ENV=production`; confirm `/create` and `/dashboard` redirect to auth.
2. No anonymous project/API access.
3. With auth configured, create/read/update only owner projects.
4. Verify Stripe/MuAPI source status before exposing paid generation.

## Known Validation Limitation

This container has no browser screenshot runner. Route compilation, HTTP route checks, CSS inspection, unit tests, lint, build, and source/security audits are available; full viewport interaction must be completed in CI/preview with Playwright before launch.
