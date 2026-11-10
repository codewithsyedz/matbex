# Matbex target architecture

A modular monolith on Fastify and PostgreSQL, with Redis for cache, queues and coordination,
deployed as Docker containers behind Cloudflare. This page records each decision, what is
built today, and what is still to do. Details live in the linked documents.

```
Cloudflare (DNS · WAF · CDN · edge rate limits)                         CLOUDFLARE.md
   └─ Caddy (TLS, real client IP)
        ├─ web      Vite + React SPA: dashboard, POS, KDS (also the Android app)
        ├─ site     Next.js public website (planned)
        └─ api      Fastify: auth · /rest/v1 · /api/v1 domain modules · realtime · functions
                      │
   worker (same image, ROLE=worker): schedules · net.http queue · background tasks (BullMQ)
                      │
   PostgreSQL 16 (RLS, transactions) · Redis (cache, queues, rate limits) · S3 / R2 (files)
   Prometheus · Loki · Tempo · Grafana (OBSERVABILITY.md)
```

## Decisions

| Area | Decision | Status |
| --- | --- | --- |
| Application | Modular monolith, no microservices, no Kubernetes until there is an operational need | In place: one API codebase |
| Backend | Fastify | In place |
| Frontend: app | **Keep Vite + React** for dashboard, POS and KDS. These are behind login, work offline and are packaged as the Android app from a static build, so server rendering adds nothing there. | In place |
| Frontend: public website | **Next.js** for the marketing, SEO, blog, pricing and tools pages (~60 routes), where server rendering helps search | Planned (decided 2026-11-09) |
| Database | PostgreSQL, one shared database, tenant isolation with RLS | In place |
| Data access | SQL plus Drizzle for new domain modules (schema generated from the existing database); existing SQL functions stay | **In place** for `/api/v1` (see Domain modules) |
| Multi-tenancy | `tenant_id` on tenant-owned tables, `branch_id` where branch-specific, composite foreign keys against cross-tenant references | Partly: RLS everywhere; some tables are keyed by `restaurant_id`. Composite keys go in for new tables and as each domain moves. |
| Authentication | Dedicated auth module (passwords, refresh rotation, TOTP MFA) | In place (`server/src/auth`) |
| Authorization | RBAC in the application plus PostgreSQL RLS | RLS in place; SECURITY DEFINER functions now check tenant access (FUNCTION_ACCESS_REVIEW.md). Role checks are added per module. |
| Realtime | Socket.IO fed by a transactional outbox through Redis (POS → kitchen, other terminals) | **Done for the kitchen display** (see below). Other screens still use the RLS-filtered change feed (`/realtime/v1`) until they move. |
| Background processing | BullMQ + Redis in a separate worker service | **Done** (see below) |
| Cache | Redis | **Done** (`cache-proxy`, shared rate limits) |
| Storage | S3-compatible: MinIO in compose, Cloudflare R2 or AWS S3 in production | Driver ready; R2 needs only settings (`S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com`, `S3_REGION=auto`) |
| Edge | Cloudflare DNS, WAF, CDN, rate limits | **Done**: Caddy trusts Cloudflare for client IPs; guide in CLOUDFLARE.md |
| Hosting | Docker containers; managed PostgreSQL (backups, point-in-time recovery) and managed Redis in production | Compose ready. Managed services are settings changes: `DATABASE_URL`, and `REDIS_URL` (`rediss://` for TLS). Migrations and the data-move script need an owner-level database role. |
| Observability | OpenTelemetry, Prometheus, Loki, Tempo, Grafana | **Done** (OBSERVABILITY.md) |
| CI/CD | GitHub Actions | Partly: lint workflow only. Build, test, migration check and image publishing are to do. |

## Workloads

| Workload | Image / command | Responsibility |
| --- | --- | --- |
| `api` | `server/Dockerfile`, `ROLE=api` | HTTP: auth, data, storage, realtime, server functions |
| `worker` | same image, `server/dist/worker.mjs`, `ROLE=worker` | Scheduled jobs, `net.http_post()` deliveries, background tasks |
| `web` | `deploy/web.Dockerfile` | Static Vite build (dashboard, POS, KDS) |
| `site` | Next.js (planned) | Public website |

`ROLE=all` (the default) runs the API and the jobs in one process, for local development and
small single-server installs.

## Background jobs (BullMQ)

The worker runs three queues under the Redis prefix `matbex:bull`:

* **schedules**: every active `cron.job` row and the default function schedules
  (`server/src/jobs/schedules.ts`, overridable with `JOB_SCHEDULES_JSON`) become BullMQ job
  schedulers. Each tick runs once, however many workers there are, so the worker can be scaled.
  The worker re-reads `cron.job` every minute: `cron.schedule()` and `cron.unschedule()` take
  effect without a restart. Results are still written to `cron.job_run_details`.
* **http**: rows that `net.http_post()` writes to `net.http_request_queue`. Calls to external URLs
  are retried 4 times with exponential backoff (5 s, 10 s, 20 s) on network errors, 5xx and 429.
  Calls to in-process functions (`…/functions/v1/<name>`) are not retried, because they may send
  email or messages. The final status is written back to the row.
* **tasks**: for new modules (notifications, report generation, integrations).

Without `REDIS_URL` the API falls back to the in-process scheduler (one leader per database via
an advisory lock, no retries).

Verified locally with two worker replicas:
* an every-minute job ran exactly once per minute for 12 minutes, with no gaps;
* a job added with `cron.schedule()` started within a minute, and `cron.unschedule()` removed it;
* a failing external URL got 4 attempts with backoff, then its status was recorded;
* an in-process function call ran once.

Metrics: `matbex_queue_jobs{queue,state}` and `matbex_job_runs_total`, under the Prometheus job
`matbex-worker`.

## Realtime events (outbox + Socket.IO)

```
POS sale / guest order / KDS update ── one Postgres transaction ──► row change + platform.outbox_events
                                                                     │ NOTIFY on commit
worker: outbox publisher (FOR UPDATE SKIP LOCKED) ──► Redis channel matbex:events ──► marks published
API (every instance): Socket.IO /socket.io ──► room "kds:<restaurant_id>" ──► kitchen displays, POS
```

* **Producing events.** Triggers on `pos_kds_tickets` and `pos_kds_ticket_items` call
  `platform.emit_event()`, so every path that creates or changes a ticket emits events, including
  the POS-sale and guest-order database triggers. New modules call `platform.emit_event(topic,
  type, restaurant_id, aggregate_id, payload)` inside their own transaction. An event exists only
  if its transaction committed. `platform` is not exposed through `/rest/v1`.
* **Publishing.** Rows are marked published only after the Redis publish succeeded, in the same
  transaction. If Redis is down, events wait in the table and go out when it is back (tested:
  delivered about 2 s after Redis returned). Published rows are deleted after
  `OUTBOX_RETENTION_HOURS` (72).
* **Delivering.** Clients connect to `/socket.io` with their access token (websocket transport
  only, so API replicas need no sticky sessions) and `subscribe` to `{ topic: "kds",
  restaurantId }`. The server joins the room only if `public.can_access_restaurant()` is true
  for that user, checked in Postgres as the caller. The connection closes when the token expires,
  and the client reconnects with the refreshed token.
* **Client.** `subscribeEvents()` in `src/integrations/db/events.ts`. Events mean "this changed,
  refresh". After every reconnect the client refetches, because events sent while it was offline
  are not replayed. The kitchen display uses it (`src/hooks/useKDS.ts`) and keeps a 30-second
  refetch as a safety net (it was 10 seconds of polling).
* **Data move.** `migrate-from-supabase.mjs` copies with triggers off, so importing production
  does not flood the outbox.
* **Metrics.** `matbex_outbox_pending`, `matbex_outbox_published_total`,
  `matbex_outbox_publish_lag_seconds`, `matbex_socket_connections` and
  `matbex_socket_events_emitted_total`.

Verified locally:
* no token is refused;
* a user can join their own restaurant's room but not another tenant's;
* ticket created and status changed both arrive, with nothing from the other tenant;
* the kitchen display shows a new ticket in under a second;
* events survive a Redis outage;
* `/realtime/v1` still works alongside Socket.IO (both share the HTTP server through an upgrade
  dispatcher in `server/src/realtime/socket.ts`).

## Domain modules (`/api/v1`)

New business endpoints are typed modules in `server/src/modules/<domain>/`, registered in
`server/src/modules/index.ts` under `/api/v1`:

| File | Responsibility |
| --- | --- |
| `<name>.schema.ts` | JSON schema for the request (Fastify validates it with AJV) and TypeScript types for request and response |
| `<name>.routes.ts` | HTTP only: `requireUser()`, headers, status codes |
| `<name>.service.ts` | Business rules. Opens **one** transaction (`inServiceTx`), checks the caller's role (`requireRestaurantRole`), writes everything that belongs together, and emits outbox events in the same transaction |
| `<name>.repository.ts` | Drizzle queries (typed, `server/src/db/generated/schema.ts`) plus raw SQL where needed; **every query is scoped by `restaurant_id`** |

Rules:
* Modules run as the table owner, with the caller's JWT claims set so triggers still see
  `auth.uid()`. RLS does not protect these queries, so the service must call
  `requireRestaurantRole` and the repository must filter by restaurant.
* Database triggers stay the source of truth for cross-cutting rules (credit limits, stock,
  ledger hooks, ZATCA validation, kitchen tickets). Modules call into them instead of
  re-implementing them.
* Modules use their own connection pool (`MODULE_DB_POOL`, default 10), because Drizzle changes
  the pool's type parsers (timestamps as strings).
* Regenerate the Drizzle schema after a migration that touches a module's tables:
  `npm --prefix server run db:schema`. Add new tables to `TABLES` in `server/drizzle.config.ts`.
* Browser side: `src/lib/api/<domain>.ts` on top of `apiRequest()` in `src/lib/api/http.ts`.

### First module: POS sales (`POST /api/v1/pos/sales`)

The POS screen (`src/pages/RecordSale.tsx`, online path) used to make about 8 separate writes from
the browser: sale, lines, cash event, then per ingredient a usage row, a stock update
(read-modify-write) and a possible reorder request, none of them in one transaction. It now
makes one call. The server:

* checks that the caller is owner, manager, cashier or waiter of the restaurant (or superadmin);
* validates that menu items, shift, customer, table and branch belong to that restaurant;
* recomputes totals with the branch's VAT rate and pricing mode, using the same code as the
  screen (`src/lib/vatInclusive.ts`, imported by the server);
* assigns sequential receipt numbers per restaurant and day (`RCP-YYYYMMDD-0001`, …) instead of
  4 random digits that collide on busy days;
* honours an `Idempotency-Key` (stored in `pos_idempotency_keys`), so a retry returns the first
  sale instead of creating a second one, including two requests racing with the same key;
* writes sale, lines, cash event and reorder requests in one transaction, lets the database
  triggers deduct stock and create the kitchen ticket, and emits `pos.sale.created` (Socket.IO
  topic `pos`).

The offline path (IndexedDB queue → `pos-sync`) is unchanged. The `/rest/v1` tables are not
blocked yet, because other screens (daily sales recorder, backfill) still write them directly.

Verified locally:
* totals match the screen to the cent;
* stock is deducted once;
* 5 concurrent sales of the same dish lose no deduction;
* idempotent replay works, sequentially and concurrently;
* other tenants' restaurants and menu items are refused;
* validation errors return 400;
* the event reaches Socket.IO;
* a sale from the POS screen in the browser went through end to end.

Part two (all POS screens and the offline queue on the module):
* **Server prices.** Each line names its size tier (`regular`/`quarter`/`half`/`full`); the server
  prices it from `menu_items` with the branch's `menu_item_branch_prices` row for the business
  day laid over it (the terminal's own rule). Without `branchId` the base menu prices apply, as
  on the terminal's all-branches view. A terminal that sends the price it showed gets
  `409 price_changed` (`details.lines`: shown vs current) when it is stale; the POS screens put
  the current prices into the cart and ask the cashier to check the total.
* **Quote.** `POST /api/v1/pos/sales/quote` prices an order without recording it. The dashboard
  sales recorder charges the Hala card terminal the quoted total and then records the sale with
  the approval (`cardTerminal`), so the card and the receipt always agree.
* **One key per checkout.** RecordSale, RecordSaleMobile and SalesRecorder use the same
  idempotency key for the online request and, on a network failure, the offline queue's ORDER.
  `pos-sync` replays queued orders through `POST /api/v1/pos/sales` with that key and
  `offline: { receiptNumber, createdAt }`: an order whose online attempt committed comes back as
  a duplicate; a real offline sale keeps its printed receipt number, time of sale and charged
  prices, and may land in a shift that has closed since. Its PAYMENT item is skipped when the
  API already put the sale in the drawer.
* **Cash drawer.** The shift cash event is the VAT-inclusive total and only for paid sales (the
  desktop screen used to record the net amount, so expected cash at shift close was short by
  the VAT; unpaid sales counted as cash received).
* **Browsers can no longer insert `sales_items`** (`20261110093956`). Editing and deleting lines
  (sales history, customer tabs) still go through `/rest/v1` under RLS.

Back office (`sales-admin.*`):
* `POST /pos/sales/summary`: amount-only sales. `manual` (Sales page: one amount, optional
  backdate and shift, numbered in the RCP sequence), `end_of_day` / `end_of_day_no_pos` (Day-End
  summary) and `backfill_adjustment` (POS backfill reconcile, may be negative). Amounts include
  VAT, split with the branch rate unless `vatPercent` is given. **End-of-day totals used to be
  stored with zero VAT**; they now carry the branch VAT like every other sale.
* `POST /pos/sales/:id/void` replaces the delete buttons on Sales and Customer Detail (deletes
  were already refused by `trg_prevent_sales_hard_delete`, but the Sales page first deleted the
  sale's lines, which put stock back and left a sale without lines). A void is a negative mirror
  sale `VOID-<receipt>` linked by `voids_transaction_id`; the original gets `voided_at/by/reason`.
  Stock and provisional COGS are reversed, food-cost rows removed, the open kitchen ticket
  cancelled, a paid sale refunded from an open shift's drawer, a credit sale settled (off the
  customer's balance). Refused for sales reported to ZATCA (credit note) or on a settlement
  invoice.
* `PATCH /pos/sales/:id`: amount/VAT/payment method of amount-only sales, and moving a sale to
  another shift (its drawer entry moves with it).
* `PATCH|DELETE /pos/sales/:id/lines/:lineId` (Sales Breakdown): the line is replaced through the
  `sales_items` triggers, so stock, provisional COGS, food cost, the sale's totals and the drawer
  follow. A direct update used to change none of them.
* Browsers can no longer insert or delete `sales_transactions`, or update/delete `sales_items`
  (`20261110171928`). Lines without a sale never reach the kitchen screen any more
  (`20261110165205`), and voids do not notify managers as new sales.

Customer credit (`server/src/modules/credit`, `/api/v1/credit/*`): settlement invoices
(create from open credit sales or a custom amount, edit dates/notes/overdue, delete only while
unpaid), invoice payments (posted to the ledger by the existing trigger, allocated to the
invoice's sales oldest first), instalments on one sale, write-offs and their reversal, and manual
balance adjustments. CustomerDetail, Settlements and the balance adjustment dialog use it.

**Customer balances follow one rule now** (`20261110172707`): what unpaid, non-voided sales
still owe (total minus paid), plus manual adjustments not tied to a sale, minus payments on
custom-amount invoices; recomputed by the database whenever a sale, adjustment or invoice
changes. Before, two triggers used different rules and several flows counted the same money
twice: a write-off settled the sale *and* subtracted the write-off; a sale paid off in instalments
dropped out *and* kept its credits; a fully paid invoice settled its sales *and* subtracted a
settlement adjustment; partial invoice payments lowered nothing. The migration recomputes every
customer, so **existing balances will change at cutover**: run
`docs/self-hosting/customer-balance-review.sql` on the rehearsal copy first to see which.

Browsers can no longer write `settlement_invoices`, `settlement_payments`,
`customer_balance_adjustments` or `settlement_audit_logs`, and may update only the ZATCA columns,
`branch_id` and the amounts of `sales_transactions` (`20261110173940`). Invoices with payments can
no longer be deleted (their receipts are in the ledger); deleting one used to remove its payments
and audit trail.

Not changed, needs an accountant's decision: instalments and write-offs are not posted to the
ledger (`post_balance_adjustment_to_ledger` exists but nothing calls it), and instalments paid in
cash do not reach the shift drawer.

Still updating `sales_transactions` from the browser (column-limited): the ZATCA helpers
(src/lib/zatca), VatAudit (amounts) and VatReceiptDrilldown (branch). Combo packages cannot be
sold today (their id is sent as a menu item and the foreign key rejects it; the API answers
`menu_item_not_found`).

### Defects found while building it (fixed in migrations)

* **Sales of dishes with recipes failed on a database built from the migrations.** The trigger on
  `sales_items` records stock movements of type `sale_consumption`, which the
  `stock_movements` check constraint never allowed (`20261109220856`; production may have been
  widened by hand).
* **Provisional COGS could fail the whole sale.** When inventory and COGS accounts resolve, the
  same trigger inserted a journal batch without `created_by` (NOT NULL, no default). This would
  have started breaking recipe sales for every tenant that received accounts from the
  chart-of-accounts backfill (`20261109102727`). Fixed in `20261109221347`, which also makes its
  stock update atomic.
* **The POS screen deducted recipe stock twice or more.** The `sales_items` trigger deducts.
  Then the screen inserted `inventory_usage` rows, whose own trigger
  (`auto_deduct_inventory_stock`) deducts again, and finally wrote back a stock value computed
  in the browser. The API path deducts once, through the `sales_items` trigger. It still writes
  `inventory_usage` rows, because the food-cost reports (Reports, Prime Cost card, Daily Profit,
  COGS page, weekly COGS) sum that table, but each row carries `sale_item_id`, which makes its
  triggers skip the stock check and deduction (`20261110072331`). A row is accepted only if it
  matches a stock posting of that sale line, and it is removed when the line is deleted. Rows
  are written with `ledger_posted = true` because the provisional COGS flow already owns the
  journal, so the COGS posting screen cannot post the same expense twice.
* **Shifts could not be closed.** `lock_shift_inventory_on_close()` compared the enum status with
  `COALESCE(OLD.status, '')`; `''` is not a `shift_status`, so every update to `closed` failed
  (`20261110094513`). Worth checking whether shifts close in production.
* **Offline sales from the desktop POS were queued under the branch id**, but the sync engine
  drains the queue by restaurant id, so only the background service worker (Chromium) could
  send them. They are now queued under the restaurant with the branch in the payload.
* **ZATCA status changes failed.** Five functions (append_zatca_audit, the audit-chain checks,
  verify_terminal_key) call pgcrypto's `digest()`/`hmac()` with `search_path = public`, but
  pgcrypto lives in `extensions`; every update of a sale's `zatca_clearance_status` rolled back
  (`20261110170020`). Supabase also installs pgcrypto in `extensions`, so check production.

## Next steps, in order

1. Move the POS terminal's own live updates (ticket ready, table status) onto events, then retire
   the matching `/realtime/v1` subscriptions screen by screen.
2. ZATCA status writes and VAT corrections on the module, then revoke the remaining column
   UPDATE grants on `sales_transactions`.
3. R2 and managed PostgreSQL/Redis: settings and a test run.
4. GitHub Actions: typecheck, unit tests, migrations on a fresh database, smoke test, image build
   and push, deploy.
5. Next.js public website.
