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
| Data access | SQL plus Drizzle for new domain modules (schema generated from the existing database); existing SQL functions stay | Planned with the first `/api/v1` module |
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

## Next steps, in order

1. Move the POS terminal's own live updates (ticket ready, table status) onto events, then retire
   the matching `/realtime/v1` subscriptions screen by screen.
2. First `/api/v1` domain module (Orders/POS): routes, AJV schemas, service, Drizzle repository,
   role checks, outbox events. Block its tables from `/rest/v1` once the app uses it.
3. R2 and managed PostgreSQL/Redis: settings and a test run.
4. GitHub Actions: typecheck, unit tests, migrations on a fresh database, smoke test, image build
   and push, deploy.
5. Next.js public website.
