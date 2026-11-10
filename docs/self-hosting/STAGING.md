# Staging server

A production-shaped copy of the stack for rehearsing the data move and cutover.

| | |
| --- | --- |
| App | https://staging.matbex.com |
| API | https://staging-api.matbex.com (`/health`) |
| Server | Contabo Cloud VPS 4 (4 vCPU, 8 GB, 100 GB), Ubuntu 24.04, region "Hub Europe" |
| SSH | `ssh matbex-staging` (user `deploy`, key `~/.ssh/id_ed25519_matbex_staging`) |
| Code | `/home/deploy/matbex` (commit in `.deployed-commit`), secrets in `.env` (mode 600) |

"Hub Europe" is Germany (~95 ms from Saudi Arabia). Fine for staging; production placement should
follow latency and Saudi data-residency requirements.

## How the server is set up

* SSH: keys only, no root login (`/etc/ssh/sshd_config.d/00-hardening.conf`); `ufw limit 22`
  (more than 6 connections in 30 s from one address are refused for a while; the SSH config uses
  `ControlMaster` to reuse one connection). fail2ban and unattended security upgrades are on.
* Firewall: `ufw` denies everything incoming except SSH. Docker publishes Caddy's 80/443, which
  bypasses `ufw`, so `/etc/ufw/after.rules` and `after6.rules` add a `DOCKER-USER` block: web
  traffic only from Cloudflare's IP ranges, every other connection to a container from `eth0`
  dropped. The origin is therefore reachable only through Cloudflare. Update the ranges there if
  Cloudflare changes them (https://www.cloudflare.com/ips/), then `sudo ufw reload`.
* Cloudflare: `staging` and `staging-api` A records, proxied; SSL/TLS "Full (strict)". Caddy
  gets Let's Encrypt certificates over HTTP-01 through Cloudflare.
* `.env` was generated on the server (own JWT secret, keys and passwords; never production's).
  Differences from production: `AUTH_AUTOCONFIRM=true` (no email is sent from staging),
  `STORAGE_DRIVER=fs` (files in the `objects` volume until R2 is set up), and every integration
  key (Resend, Twilio, Stripe, Checkout.com, Hala, Anthropic) and `ZATCA_BASE_URL` empty, so
  staging sends no messages or payments and ZATCA runs in simulation.
* Docker logs rotate at 20 MB x 5 per container.

## Deploy a commit

From the repo on your machine (copies the commit, not your working tree or `.env`):

```sh
git archive --format=tar HEAD | ssh matbex-staging "tar -x -C ~/matbex && echo $(git rev-parse --short HEAD) > ~/matbex/.deployed-commit"
ssh matbex-staging 'cd ~/matbex && docker compose build && docker compose run --rm migrate && docker compose up -d'
```

With monitoring: add `-f docker-compose.yml -f docker-compose.observability.yml` to `up`.

## Smoke test (inside the server; the API is not reachable except through Cloudflare)

```sh
ssh matbex-staging 'cd ~/matbex && docker run --rm --network matbex_default --env-file .env -e API_URL=http://api:8000 -v $PWD:/src:ro node:22-alpine sh -c "mkdir /work && cd /src && tar --exclude=./server/node_modules --exclude=./node_modules --exclude=./android -cf - . | tar -xf - -C /work && cd /work/server && npm ci --no-audit --no-fund >/dev/null 2>&1 && npx tsx scripts/smoke-test.ts"'
```

## Grafana

Bound to the server's loopback only. Open a tunnel, then browse http://localhost:3300 (user
`admin`, password `GRAFANA_ADMIN_PASSWORD` from the server's `.env`):

```sh
ssh -N -L 3300:127.0.0.1:3300 matbex-staging
```

## Data-move rehearsal (production data on staging)

Lovable Cloud does not expose the production database URL or service-role key, so the source
is Lovable's full export (More → Database → Manage → Settings → Export data; once per 24 h;
pg_dump custom format, includes `auth.users` with password hashes, not the storage files).

Done on 2026-11-11 with the export of 2026-11-10 (5 tenants, 14 users, 48,558 sales):

1. Copy the export to the server: `~/export/` (mode 700, file 600).
2. `server/scripts/restore-lovable-export.sh ~/export/<file>.backup` restores it into a
   throwaway container `prodcopy` on `matbex_default` (14 expected errors for Supabase-only
   extensions; scheduled jobs loaded into a plain `cron.job` table).
3. `docker compose stop worker`, then run the data move from a `node:22-alpine` container on the
   network (as for the smoke test) with `SOURCE_DATABASE_URL=postgres://postgres:<.prodcopy-pw>@prodcopy:5432/prod`
   and `--yes --fresh --skip files,urls`. Result: 327/327 tables match, 629,587 rows, 41.5 s;
   fixups seeded the chart of accounts for 2 tenants, no balance changes.
4. Staging must not message real customers: the copied jobs that send (reports, summaries,
   WhatsApp, reminders, expiry alerts, export emails, payments reconciler) are set
   `active = false` in `cron.job`, and `JOB_SCHEDULES_JSON` in the server's `.env` sets the same
   functions to `null` (an inactive cron row would otherwise fall back to the built-in schedule).
   Then `docker compose up -d worker`; it registered 11 schedules.
5. Smoke test (27/27 with production data), then remove `prodcopy` and the export.

Still to do on staging: the storage files (2,667 objects, 380 MB: public `menu-images` and
`press-assets`; private `expense-receipts` 2,564 readable by the superadmin, `invoice-images` 18
readable only by that restaurant's users), then `--steps urls --rewrite-urls --yes` (123
`menu_items.image_url` values still point at the old Supabase host).
