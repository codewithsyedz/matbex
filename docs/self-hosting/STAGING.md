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
  `STORAGE_DRIVER=s3` with files in the R2 bucket `matbex-staging-files` (since 2026-11-13; its own
  token, read/write on that bucket only; `S3_ENDPOINT` is the account's R2 endpoint, `S3_REGION=auto`),
  and every integration
  key (Resend, Twilio, Stripe, Checkout.com, Hala, Anthropic) and `ZATCA_BASE_URL` empty, so
  staging sends no messages or payments and ZATCA runs in simulation.
* Email: staging uses the production Resend account but `EMAIL_ALLOWED_RECIPIENTS` limits it to
  the listed addresses / @domains (server/src/email/recipientGuard.ts filters every call to
  Resend's API; other recipients are dropped and logged). Allow-list: `ssh -t matbex-staging
  '~/set-email.sh'`; key from the Mac clipboard: `pbpaste | ssh matbex-staging '~/set-resend-key.sh'`.
  Never leave the key set with an empty allow-list while staging holds production data.
  Sender: `noreply@notify.matbex.com` (Resend domain `notify.matbex.com`, verified 2026-11-11).
  `mail.matbex.com` cannot be used: its NS records delegate it to Lovable's email service.
  Without email, `ssh -t matbex-staging '~/reset-link.sh <email>'` prints a one-time reset link.
* Docker logs rotate at 20 MB x 5 per container.

## Deploy a commit

Automatically: every push to `custom-backend` runs CI (lint, typecheck, unit tests, bundle
budget, migrations on an empty database, RLS audit, smoke test); when all pass, the
`deploy-staging` job copies the commit to the server with `git archive` and runs
`deploy/staging-deploy.sh` there (build, migrate, restart, smoke test). It uses its own SSH key
(`~/.ssh/id_ed25519_matbex_staging_ci`, comment `github-actions-deploy`), and is skipped until
these repository secrets exist: `STAGING_HOST`, `STAGING_SSH_KEY`, `STAGING_KNOWN_HOSTS`.
To revoke CI access, delete the `github-actions-deploy` line from `~deploy/.ssh/authorized_keys`.

By hand, from the repo on your machine:

```sh
git archive --format=tar HEAD | ssh matbex-staging "tar -x -C ~/matbex && echo $(git rev-parse --short HEAD) > ~/matbex/.deployed-commit"
ssh matbex-staging 'bash ~/matbex/deploy/staging-deploy.sh'
```

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

Storage files (Lovable gives no service key): `server/scripts/copy-supabase-files.mjs` reads the
file list from the new database and downloads public buckets by URL; with `--email` it signs in
to the old project as that user (password at a hidden prompt) and copies the private files that
account may read. On the server: `~/copy-files.sh` (dry run), `~/copy-files.sh --yes` (public:
85 files copied 2026-11-11), `ssh -t matbex-staging '~/copy-files.sh --yes --email <you>'` (private).
Reports go to `~/files-reports/`.

Done 2026-11-11: 2,649 of 2,667 files on staging (expense receipts 2,564 via the superadmin
account, menu images 81, press assets 4). The 18 `invoice-images` files belong to one restaurant
the superadmin has no role in; that restaurant's owner can copy them with the same command, or
they can be downloaded by hand. The 123 `menu_items.image_url` links were then switched from the
old host to `https://staging-api.matbex.com` (on cutover day the data move's
`--steps urls --rewrite-urls --yes` does this against the restored export).

## Backups

Nightly encrypted database and file backups to Cloudflare R2, with a tested restore: see [BACKUPS.md](BACKUPS.md).

## Monitoring

Alerts to Telegram and email from Grafana: see [MONITORING.md](MONITORING.md).
