# Playwright e2e — offline POS scenarios

These specs drive the running Vite dev server (`http://localhost:8080`) against a
real Lovable Cloud backend. They are **not** wired into `bun test` because they
need a signed-in cashier and a paired terminal.

## Prerequisites

```bash
bun add -d @playwright/test
bunx playwright install chromium
```

Set the following env vars before running:

| Var | Purpose |
| --- | --- |
| `E2E_BASE_URL` | Defaults to `http://localhost:8080` |
| `E2E_CASHIER_EMAIL` | Login for a branch-scoped cashier |
| `E2E_CASHIER_PASSWORD` | Password for the cashier account |
| `E2E_BRANCH_ID` | Restaurant/branch UUID the cashier is pinned to |
| `E2E_OWNER_EMAIL` / `E2E_OWNER_PASSWORD` | Owner/manager login for the deep-link spec |

If any required var is missing the spec is skipped (it will not fail CI).

## Run

```bash
bunx playwright test e2e/offline-sale.spec.ts
```

## What it covers (Epic E1)

`offline-sale.spec.ts` — login → open shift → force the browser offline via
`context.setOffline(true)` → record 3 sales → go back online → wait for the
sync engine to drain → assert all 3 receipts appear in the cloud sales list
with the same idempotency keys that were minted on the client.

`notification-deeplink.spec.ts` — sign in → open `/sales?notif=…&src=notification`
→ assert the URL never bounces (no `/onboarding` → `/dashboard` hop), the Sales
page renders, and two refreshes keep the same URL and params. Guards the
`ProtectedRoute` fix that waits for tenant/roles to settle before redirecting.
A fast source-level companion runs in CI:
`src/lib/__tests__/notificationDeepLinkRouting.test.ts`.