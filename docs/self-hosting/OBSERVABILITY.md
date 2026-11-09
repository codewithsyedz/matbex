# Observability

Metrics (Prometheus), logs (Loki), traces (Tempo, via OpenTelemetry) and dashboards (Grafana),
shipped by Grafana Alloy. Everything runs next to the main stack:

```sh
docker compose -f docker-compose.yml -f docker-compose.observability.yml up -d
```

Set `GRAFANA_ADMIN_PASSWORD` in `.env` first. Grafana listens on `127.0.0.1:3300` only. From your
machine, open it through an SSH tunnel:

```sh
ssh -L 3300:127.0.0.1:3300 you@server   # then open http://localhost:3300 (user admin)
```

## What is collected

| Signal | Source | Where |
| --- | --- | --- |
| API metrics | `server/src/lib/metrics.ts`, served on the internal port 9464 (`/metrics`), never through Caddy | Prometheus, job `matbex-api` |
| Postgres metrics | `postgres-exporter` (connections, locks, database size, replication) | Prometheus, job `postgres` |
| Redis metrics | `redis-exporter` (memory, hit ratio, clients) | Prometheus, job `redis` |
| Logs | stdout of every container in this compose project (the API logs JSON; `level` becomes a label and the request id is structured metadata) | Loki |
| Traces | `server/src/otel.ts` (incoming HTTP, outgoing HTTP/fetch, Redis), turned on by `OTEL_EXPORTER_OTLP_ENDPOINT` | Alloy → Tempo |

API metrics (all prefixed `matbex_`):

| Metric | Labels | Meaning |
| --- | --- | --- |
| `http_request_duration_seconds` | `method`, `route` (template), `status` (2xx…) | Request rate, latency, errors |
| `function_invocations_total`, `function_duration_seconds` | `function`, `status` | Server functions (`/functions/v1/<name>`) |
| `job_runs_total` | `job`, `kind` (sql / function), `result` | Scheduled jobs |
| `net_http_deliveries_total`, `net_http_queue_pending` | `status` | `net.http_post()` queue |
| `dependency_up` | `dependency` (postgres, redis) | 1 up, 0 down, -1 not configured |
| `nodejs_*`, `process_*` | | Event-loop lag, memory, CPU, GC |

The **Matbex API** dashboard (folder *Matbex*) shows all of the above plus recent API errors from
Loki. Log lines that contain a `trace_id` link to the trace in Tempo.

## Retention and size

| Store | Default retention | Change with |
| --- | --- | --- |
| Prometheus | 30 days | `PROMETHEUS_RETENTION` in `.env` |
| Loki | 30 days | `retention_period` in `deploy/observability/loki.yml` |
| Tempo | 7 days | `block_retention` in `deploy/observability/tempo.yml` |

## Alerts to add first

Configure these in Grafana (*Alerting → Alert rules*) with your contact point (email, Slack,
WhatsApp via webhook):

* `matbex_dependency_up{dependency="postgres"} == 0` for 1 minute.
* 5xx ratio above 2% for 5 minutes (the "5xx ratio" panel query).
* `increase(matbex_job_runs_total{result="failed"}[1h]) > 0` for the scheduled jobs that matter
  (day-end, payments reconciler, ZATCA clearance).
* `matbex_net_http_queue_pending > 100` for 10 minutes (deliveries are stuck).
* The `api` container not reporting (`up{job="matbex-api"} == 0`).

## Running without it

Nothing in the API depends on this stack. Without `OTEL_EXPORTER_OTLP_ENDPOINT`, tracing stays off.
`/metrics` is still served on the internal port and is harmless; set `METRICS_PORT=0` to turn it off.
