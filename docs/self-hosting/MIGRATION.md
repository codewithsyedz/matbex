# Matbex self-hosting migration

From Lovable + Supabase (hosted) to a stack you own and run: **React web app → Matbex API (Node/Fastify) → PostgreSQL 16**.
This document records what was found, what changed, how to cut over production, and what to do next.

---

## 1. Starting point (analysis)

| Area | Hosted setup found in the repo |
| --- | --- |
| Size | ~344k lines of TS/TSX, 1,310 source files |
| Data access | 522 frontend files called the Supabase SDK directly: 266 tables, 162 RPCs, 56 functions invoked |
| Database | 569 Supabase migrations + 44 Lovable/drizzle migrations; 333 relations, 461 SQL functions, 833 RLS policies (`auth.uid()` used ~1,700 times) |
| Auth | Supabase Auth: password, email links, TOTP MFA, admin user APIs |
| Storage | 14 buckets (+2 created by hand in the dashboard), 115 storage RLS policies |
| Realtime | 25 tables in the realtime publication, 27 subscriptions in the UI |
| Edge functions | 101 Deno functions (Stripe, Checkout.com, Hala, ZATCA, Twilio, Resend, reports, terminal API, POS sync…) |
| Scheduling | `pg_cron` + `pg_net` calling functions over HTTP; most schedules were created in the dashboard |
| Lovable lock-in | `lovable-tagger`, `@lovable.dev/mcp-js` (MCP + OAuth consent page), preview-auth broker, Lovable AI gateway (journals, Arabic CMS translation), Lovable connector gateway (Twilio, Semrush), Lovable managed email (`@lovable.dev/email-js`, auth email hook), `*.lovable.app` hosts in CORS / tenant routing / PWA guards |

**Key observation:** the business logic and security model live in Postgres (SQL functions + RLS), not in the
SDK. That made a *strangler* migration possible: keep the database contract, replace everything around it.

## 2. Target architecture

```
Browser / Android ──► Caddy (TLS) ──► web (nginx, static build)
                                 └──► api (Node 22, Fastify) ──► PostgreSQL 16
                                          │   └──► PostgREST (private, :3000)
                                          ├──► S3 / MinIO / local disk
                                          ├──► Resend · Anthropic · Stripe · Twilio · …
                                          └──► jobs (cron + net.http queue, leader-elected)
```

| Concern | Implementation | Code |
| --- | --- | --- |
| Client SDK | `@matbex/client`, zero dependencies, same call shapes the app already used | `packages/client` |
| Auth | Own service: bcrypt passwords (existing hashes keep working), HS256 access JWT + rotating refresh tokens with reuse detection, email confirm / recovery / invite / magic link / email change, TOTP MFA (aal2), admin API | `server/src/auth` |
| Data API | `/rest/v1` gateway → PostgREST running privately; RLS + `auth.uid()` unchanged | `server/src/rest` |
| Storage | `/storage/v1`; metadata in `storage.objects` with the **same RLS policies**; bytes in S3/MinIO or local disk; signed URLs | `server/src/storage` |
| Realtime | `/realtime/v1/websocket`; NOTIFY triggers on publication tables; rows re-read **as each subscriber** so RLS applies | `server/src/realtime` |
| Server functions | Former edge functions run in-process under `/functions/v1/<name>` (Web `Request`/`Response` kept) | `server/functions`, `server/src/functions/host.ts` |
| Jobs | `cron.job` rows executed by the API; `net.http_post()` queued and delivered (function URLs dispatched in-process) | `server/src/jobs` |
| Email | Resend, suppression list + send log in Postgres, React Email templates reused | `server/src/email` |
| AI | Anthropic Claude via AI SDK (`generateObject`) and Messages API | `server/functions/_runtime/ai.ts` |
| MCP | `/mcp` Streamable HTTP, bearer = Matbex access token, 4 read-only tools | `server/src/mcp` |
| DB platform | Roles, `auth`/`storage`/`cron`/`net`/`realtime` schemas recreated in plain SQL | `db/platform` |
| Migrations | Ordered runner with checksums, baseline mode, PostgREST schema reload | `db/migrate.mjs` |
| Types | Generator from the live schema (replaces the vendor CLI); CI drift check | `scripts/generate-db-types.mjs` |

URL paths (`/auth/v1`, `/rest/v1`, `/storage/v1`, `/functions/v1`) were intentionally kept, so the Android
terminal, the Flutter sample client, webhooks registered with Stripe/Checkout.com/Twilio and any raw `fetch`
calls only need a **base URL** change.

## 3. What was verified

| Check | Result |
| --- | --- |
| All 613 migrations + 2 new ones on vanilla PostgreSQL 16 | ✅ apply cleanly (2 historical files guarded, see §6) |
| Schema parity | Regenerated types match the production-generated `types.ts` (324/324 tables, 8/8 views, 290/290 functions; extra objects are only the new email queue and one function the old types lagged on) |
| End-to-end smoke test (`server/scripts/smoke-test.ts`) | ✅ 25/25 — signup/login/refresh/logout, admin API, RLS isolation, count/head, maybeSingle, rpc, permission denial, storage upload/RLS denial/public/signed/download/list/remove, public function, `FunctionsHttpError.context`, realtime with RLS (including a second user who must not receive the row), MFA enroll→aal2, MCP |
| Web typecheck (`tsc -p tsconfig.app.json`) | ✅ 0 errors |
| API typecheck | ✅ 0 errors |
| Web production build | ✅ |
| Unit tests (vitest) | 878 passed; the same 16 tests fail before and after the migration (pre-existing) |
| Server functions | 99/99 bundle and load (7 of them need their Resend/Stripe key set to initialise) |
| `npm run lint:edge-auth` | ✅ |

**Not verified here:** Docker images were not built (no Docker daemon in the build sandbox; compose files are
syntax-checked only), and nothing has run against production data yet — do the dry run in §5 first.

## 4. Environment

Everything is in `.env.example`. Generate secrets with `npm --prefix server run keys`.
`VITE_API_KEY` is the **anon** key (public, role `anon`) — never put `SERVICE_ROLE_KEY` in a `VITE_` variable.

## 5. Production cutover runbook

Do a full dry run on a staging server with a copy of production first; time each step.

1. **Provision** the new stack: `cp .env.example .env`, fill in, `docker compose up -d --build`.
2. **Create the schema:** `docker compose run --rm migrate` (platform bootstrap + all migrations).
3. **Freeze writes** on the old system (maintenance banner, stop POS sync, disable webhooks for a few minutes).
4. **Users:** `SOURCE_DATABASE_URL=<old> DATABASE_URL=<new> npm --prefix server run import:auth`
   (copies users with their bcrypt hashes and TOTP factors; everyone signs in again once — sessions are not copied).
5. **Data:**
   ```sh
   pg_dump "$OLD" --data-only --schema=public --no-owner --no-privileges -Fc -f public.dump
   pg_restore -d "$NEW" --data-only --disable-triggers --no-owner public.dump
   ```
   Run `pg_restore` as the database owner so `--disable-triggers` works (posting/ledger triggers must not refire).
6. **Storage metadata + bytes:**
   ```sh
   # metadata (bucket config + object rows)
   pg_dump "$OLD" --data-only -t storage.buckets -t storage.objects --column-inserts | psql "$NEW"
   # bytes: old storage is S3-compatible; copy into the new bucket under <bucket>/<path>
   rclone copy old-s3:<bucket> new-s3:matbex/<bucket>   # repeat per bucket
   ```
   If the old dump has columns the new `storage.objects` lacks, drop them in the INSERTs (or dump with `--inserts` and edit).
7. **Schedules:** copy production's `cron.job` rows (`pg_dump -t cron.job --data-only`) — function-calling jobs are
   automatically routed to the in-process function. Without them, the defaults in `server/src/jobs/schedules.ts` apply.
8. **Rewrite stored absolute URLs** that point at the old host:
   ```sql
   -- find candidates first
   SELECT table_name, column_name FROM information_schema.columns
   WHERE table_schema='public' AND data_type IN ('text','character varying','jsonb');
   -- then e.g.
   UPDATE public.restaurants SET logo_url = replace(logo_url, 'https://<old-ref>.supabase.co', 'https://api.matbex.com');
   ```
9. **Verify:** row counts per table (old vs new), `npm --prefix server run smoke` against the new API, log in as an
   owner, cashier and accountant, run a sale on a POS terminal, post a day-end, run P&L and VAT reports.
10. **Switch:** point DNS / `VITE_API_URL`, rebuild the web app and Android APK (`vars.VITE_API_URL`/`VITE_API_KEY`
    in GitHub), update webhook URLs at Stripe, Checkout.com, Hala, Twilio and delivery platforms to
    `https://<API_DOMAIN>/functions/v1/<name>`.
11. Keep the old project read-only for a rollback window (e.g. 14 days), then decommission.

## 6. Changes to existing code worth knowing

* **Security fix:** `public.current_cron_token()` (the scheduler secret) was executable by `anon` because explicit
  default grants survive `REVOKE … FROM PUBLIC`. Anyone could read it via `/rest/v1/rpc/current_cron_token` and call
  scheduler-only functions. Migration `20261109000000_harden_cron_token_execute.sql` revokes it. **This very likely
  affects the current production project too — rotate the token (`cron_auth_tokens`) and apply the same REVOKE there now.**
* **Bug fix:** `create-branch` referenced an undefined `corsHeaders`, so every response threw. Fixed.
* Two dashboard-only buckets (`fine-evidence`, `zatca-application-docs`) now have a migration.
* Historical migrations guarded for fresh installs: `20260727110737` (data fix for one production user, now
  conditional) and `20260805084715` (skips aggregates when rewriting function bodies).
* Frontend: `supabase` → `db` (`@/integrations/db/client`), `VITE_SUPABASE_*` → `VITE_API_URL` / `VITE_API_KEY`,
  Lovable OAuth consent page and preview-auth broker removed, tenant preview hosts now come from `VITE_PREVIEW_DOMAIN`.
* Functions: codemod (`server/scripts/codemod-functions.mjs`) mapped Deno/URL imports to npm packages; Twilio,
  Semrush, AI and email now call providers directly. Run ID header renamed `X-AI-Run-ID`.
* `drizzle/`, `drizzle.config.ts`, `supabase/config.toml`, `.lovable/`, bun lockfiles and the committed `.env` were removed;
  public (no-JWT) functions are listed in `server/functions/functions.config.json`.

## 7. Known gaps and follow-ups

| Item | Notes |
| --- | --- |
| Realtime payloads | INSERT/UPDATE deliver the full row (RLS-checked); UPDATE `old` and DELETE carry only `id`. Filters supported: `eq, neq, lt, lte, gt, gte, in`. |
| Auth scope | No social/OAuth/SSO or phone-OTP login (none were used by the app). Customer OTP for ordering is a separate function and unchanged. |
| SECURITY DEFINER audit | 396 `SECURITY DEFINER` functions are executable by `anon`. Most check `auth.uid()` internally, but each should be reviewed; revoke `anon` where not needed. |
| Function typing | `npm --prefix server run typecheck:functions` reports 29 loose-typing issues in the ported function code (Deno never type-checked them strictly; runtime unaffected). |
| Docs | `docs/terminal-api*`, Android and runbook docs still mention the old host; the paths are unchanged, only the base URL differs. |
| Image transforms | The hosted image-resize endpoint is not replicated; the app already rewrites public storage URLs to `VITE_STORAGE_CDN_HOST` (Cloudflare). |
| Horizontal scaling | Run several `api` replicas behind Caddy; jobs are leader-elected via an advisory lock. Realtime fan-out is per instance and driven by Postgres NOTIFY, so it already works across replicas. |

## 8. Roadmap — finishing the strangler

Phase 1 (this change) removes every vendor dependency while keeping the database contract.
The browser still talks to tables through `/rest/v1`. To move to explicit, versioned endpoints:

1. **Pick a domain** (suggested order: auth/profile → POS sales → expenses → payroll → accounting/ZATCA → reports).
2. Add typed routes under `server/src/api/v1/<domain>` (zod-validated input, SQL via `asCaller()` so RLS still applies,
   or service role + explicit tenant checks).
3. Add matching functions to a small typed client (`packages/client` or `src/lib/api`), switch the hooks for that domain.
4. Block the domain's tables from the browser by adding them to `BLOCKED_TABLES` in `server/src/rest/gateway.ts`.
5. Repeat until `/rest/v1` can be closed entirely; PostgREST can then be removed.

Other recommended next steps: centralised logging/metrics (pino → Loki/Grafana), nightly `pg_dump` + WAL archiving
(e.g. pgBackRest) with restore drills, Sentry for the web app, and rate limits per tenant at the API.
