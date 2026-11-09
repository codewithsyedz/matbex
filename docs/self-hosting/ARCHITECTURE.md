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

Known limits:
* Line prices are still taken from the terminal: size variants, branch prices and market prices
  are priced on the device. Moving price lists to the server is the next step for this module.
* If the online request times out after the server already saved the sale, the screen still
  falls back to the offline queue, which can record the sale twice when it syncs (the same as
  before). Sharing one idempotency key between the online call and the offline queue would close
  this.

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
  in the browser. The API path deducts once, through the `sales_items` trigger, and does not
  write `inventory_usage` for sales. **Reports that read `inventory_usage` will no longer see
  POS sales recorded through the API**; consumption is in `stock_movements` and
  `provisional_cogs_postings`. Check which COGS reports should switch to those before go-live.

## Next steps, in order

1. Move the POS terminal's own live updates (ticket ready, table status) onto events, then retire
   the matching `/realtime/v1` subscriptions screen by screen.
2. POS sales, part two: server-side price lists, a shared idempotency key with the offline
   queue, then move the daily-sales recorder onto the module and block `sales_transactions` /
   `sales_items` writes from `/rest/v1`.
3. R2 and managed PostgreSQL/Redis: settings and a test run.
4. GitHub Actions: typecheck, unit tests, migrations on a fresh database, smoke test, image build
   and push, deploy.
5. Next.js public website.
