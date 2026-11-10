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

## Data-move rehearsal

See MIGRATION.md, "Production cutover runbook". On staging the old project's details go in the
server's `.env` (`SOURCE_DATABASE_URL`, `SOURCE_SUPABASE_URL`, `SOURCE_SERVICE_ROLE_KEY`) and the
script runs in the API image: `docker compose run --rm api node server/scripts/...` is not
available (scripts are not in the image), so run it from a `node:22-alpine` container on the
`matbex_default` network as for the smoke test. Before the worker runs the copied cron jobs,
disable the ones that send messages.
