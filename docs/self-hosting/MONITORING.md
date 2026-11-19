# Monitoring and alerts

Prometheus collects metrics, Grafana evaluates alert rules and notifies **Telegram** and **email**.
Set up on staging on 2026-11-12; production gets the same at cutover.

## What is watched

Rules live in `deploy/observability/grafana/provisioning/alerting/alerting.yml` (Grafana loads them
at start; change them there, not in the Grafana UI). Each must hold for the time shown before it
alerts; firing alerts repeat every 4 hours and send a "resolved" message when they clear.

| Alert | Fires when | Severity |
| --- | --- | --- |
| API is down | Prometheus cannot scrape the API for 2 min | critical |
| Worker is down | same for the worker, 2 min | critical |
| Database or Redis unreachable | exporters or the API/worker report PostgreSQL/Redis down, 2 min | critical |
| Disk almost full | under 15% free on `/`, 10 min | critical |
| Backup failed | the last nightly backup exited with an error | critical |
| No backup in over a day | last successful backup older than 26 h | critical |
| Server errors | over 20 HTTP 5xx in 10 min, for 5 min | warning |
| Scheduled jobs failing | over 3 failed job runs in an hour | warning |
| Live updates backed up | over 200 outbox events waiting, 10 min | warning |
| Memory almost full | under 10% available, 10 min | warning |

Sources: the API and worker (`matbex_*` on :9464), `postgres-exporter`, `redis-exporter`,
`node-exporter` (disk, memory; also reads `~/backup/metrics/*.prom` written by
`deploy/backup.sh`).

## Where alerts go

Settings in `~/matbex/.env` (set with `pbpaste | ssh matbex-staging "bash ~/set-env.sh NAME"`):

- `TELEGRAM_BOT_TOKEN`: from @BotFather (bot `@matbex_alerts_bot` on staging).
- `TELEGRAM_CHAT_ID`: your chat with the bot. Send the bot a message, then read it from
  `https://api.telegram.org/bot<token>/getUpdates` on the server (`message.chat.id`).
- `ALERT_EMAIL`: recipient; mail is sent through Resend's SMTP (`RESEND_API_KEY`) from
  `alerts@$EMAIL_FROM_DOMAIN`.

Two Grafana 12 quirks are handled in the config, keep them: the chat id is passed with a trailing
space (Grafana turns an all-digit substituted value into a number, which its Telegram integration
rejects; Telegram accepts the space), and `parse_mode: None` (Grafana's default HTML mode makes
Telegram reject its standard message with 400 "can't parse entities").

Check delivery: Grafana → Alerting → Contact points, or
`GET /api/alertmanager/grafana/config/api/v1/receivers` (last attempt and error per channel).

**Tested 2026-11-12:** the backup status was set to failed; "Backup failed" fired and reached email
and Telegram, then cleared when restored.

## Grafana

`ssh -L 3300:127.0.0.1:3300 matbex-staging`, then http://localhost:3300 (user `admin`, password
`GRAFANA_ADMIN_PASSWORD`). Not exposed to the internet.

## Outside check

Everything above runs on the server it watches: if the whole server goes down, nothing alerts. So
UptimeRobot (free plan, set up 2026-11-12) checks from outside every 5 minutes and emails the owner:

- **Keyword** monitor on `https://staging-api.matbex.com/health`, keyword `"ok":true`, alert when the
  keyword is **missing** (the reverse setting reports "Keyword has been found" as down).
- **HTTP** monitor on `https://staging.matbex.com`.

At cutover add the same for `https://api.matbex.com/health` and `https://www.matbex.com`.
