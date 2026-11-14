# Matbex

Restaurant back-office, POS and accounting platform (web app + Android POS terminal).
Fully self-hosted: React/Vite front end, a Node API you own, and PostgreSQL. No Supabase, no Lovable.

```
 Browser / Android POS ──HTTPS──►  Matbex API (server/, Fastify)  ──►  PostgreSQL 16
                                    ├─ /auth/v1       sessions, MFA, email flows
                                    ├─ /rest/v1  ───► PostgREST (private, RLS enforced)
                                    ├─ /storage/v1    S3 / MinIO / local disk
                                    ├─ /realtime/v1   websocket change feed (LISTEN/NOTIFY)
                                    ├─ /functions/v1  99 server functions (server/functions)
                                    ├─ /mcp           MCP tools endpoint
                                    └─ jobs           cron + async HTTP queue
```

| Path | What lives there |
| --- | --- |
| `src/` | Web app (React, Vite, Tailwind, shadcn/ui). API client: `src/integrations/db/client.ts` |
| `packages/client/` | `@matbex/client` — dependency-free client for auth, data, rpc, storage, functions, realtime |
| `server/src/` | API server (auth, data gateway, storage, realtime, function host, jobs, MCP) |
| `server/functions/` | Server functions (payments, ZATCA, email, WhatsApp, reports, terminal API, …) |
| `db/platform/` | Platform bootstrap SQL (roles, `auth`, `storage`, `cron`, `net` schemas) |
| `db/migrations/` | Application schema history (applied in order by `db/migrate.mjs`) |
| `deploy/`, `docker-compose.yml` | Production deployment (Caddy TLS, nginx web, API, PostgREST, Postgres, MinIO) |
| `docs/self-hosting/MIGRATION.md` | Architecture, cutover runbook from the hosted stack, roadmap |

## Local development

Requirements: Node 22+, Docker (for Postgres + PostgREST).

```sh
npm install && npm --prefix server install
cp .env.example .env
npm --prefix server run keys            # paste JWT_SECRET / ANON_KEY / SERVICE_ROLE_KEY / AUTHENTICATOR_PASSWORD into .env
```

Set these for local work in `.env`:

```sh
DATABASE_URL=postgres://postgres:postgres@localhost:5432/matbex
POSTGREST_URL=http://localhost:3000
API_URL=http://localhost:8000
SITE_URL=http://localhost:8080
VITE_API_URL=http://localhost:8000
VITE_API_KEY=<ANON_KEY>
AUTH_AUTOCONFIRM=true
STORAGE_DRIVER=fs
```

```sh
docker compose -f docker-compose.dev.yml up -d   # Postgres :5432 + PostgREST :3000
npm run db:migrate                               # platform bootstrap + all migrations
npm run dev:api                                  # API on http://localhost:8000
npm run dev                                      # web app on http://localhost:8080
npm --prefix server run smoke                    # optional end-to-end check (25 checks)
```

## Everyday commands

| Task | Command |
| --- | --- |
| New migration | `npm run db:new add_something` → edit `db/migrations/<ts>_add_something.sql` |
| Apply migrations | `npm run db:migrate` (status: `npm run db:status`) |
| Regenerate DB types | `npm run db:types` (CI fails if they drift) |
| Typecheck everything | `npm run typecheck` |
| Unit tests | `npm test` and `npm --prefix server test` |
| Build API | `npm --prefix server run build` → `server/dist` |
| Build web | `npm run build` → `dist` |

## Production

```sh
cp .env.example .env            # fill in domains, keys, S3, Resend, Anthropic, Stripe, Twilio…
docker compose up -d --build
docker compose run --rm migrate
```

Caddy obtains TLS certificates for `APP_DOMAIN` and `API_DOMAIN`. Moving existing data from the old hosted
project is covered step by step in [`docs/self-hosting/MIGRATION.md`](docs/self-hosting/MIGRATION.md).

## Android POS terminal (Capacitor)

The Android app wraps the web build. `VITE_API_URL` / `VITE_API_KEY` are baked in at build time
(CI reads them from repository variables).

```bash
npm run android:doctor       # verify JDK 21, Android SDK, ANDROID_HOME, adb, Capacitor
npm run android              # build + sync + run on device/emulator
npm run android:keystore     # one-time: generate release.keystore
npm run android:release      # → android/app/build/outputs/apk/release/app-release.apk
```

Guides: [`docs/android-local-setup.md`](docs/android-local-setup.md) ·
[`docs/android-release-checklist.md`](docs/android-release-checklist.md) ·
[`docs/terminal-api.md`](docs/terminal-api.md). The terminal API lives at
`{API_URL}/functions/v1/terminal-api` (same path as before; only the base URL changed).
