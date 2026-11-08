# Load Test & Chaos Runbook

Matbex is a multi-tenant SaaS with POS sync, real-time chat, and push fanout.
Below are the documented breaking points, target SLOs, and starter scripts so
regressions surface before customers do.

## Target SLOs (per tenant)

| Surface | Target | Hard limit | Notes |
|---|---|---|---|
| POS record-sale → ledger | p95 < 800 ms | 2 s | trg_auto_create_purchases is the long tail |
| Dashboard cold load | p95 < 2.5 s | 5 s | useProfitLoss + cache-proxy |
| terminal-api / order | p95 < 600 ms | 1.5 s | Includes JWT + device-key check |
| Realtime chat fanout | p95 < 1 s end-to-end | 3 s | Supabase Realtime, max 200 channels/tenant |
| Push notification fanout | p95 < 5 s | 30 s | Web push, batched 50/req |

## Known breaking points

1. **Concurrent users per tenant** — Comfortable: 25. Stress: 75. Above 100
   the dashboard refetches start contending on `useProfitLoss`; mitigate by
   warming `cache-proxy` keys per tenant.
2. **Sync queue depth (offline POS → ledger)** — `sales_queue` table starts
   to back up beyond 500 unprocessed rows; `auto-shift-manager` cron lag
   appears. If depth exceeds 1k, pause cron and drain manually.
3. **Audit log write rate** — `audit_logs` accepts ~300 inserts/s before
   p99 insert latency exceeds 100 ms. Triggers on feature-flag tables add
   ~5% overhead during admin bulk operations.
4. **Push fanout** — 1k subscribers/tenant takes ~6 s with current batch
   size. Above 5k, switch fanout to a queued worker.
5. **Edge function cold starts** — `generate-invoice-pdf` cold-starts at
   ~1.2 s due to pdfkit. `terminal-api` cold-starts at ~250 ms. `cache-proxy`
   cold-starts at ~150 ms. Track via `AdminEdgeFunctionHealth`.

## Chaos scenarios to rehearse quarterly

| Scenario | Expected outcome |
|---|---|
| Upstash Redis hard down | cache-proxy returns 503; dashboard falls back to direct queries (≤2× latency). No data loss. |
| Supabase Auth degraded | Login fails; existing JWTs keep working until 1h refresh. `DegradedModeBanner` surfaces. |
| Storage (press-assets bucket) 500s | Public marketing pages render with placeholder; admin uploads fail gracefully. |
| Stripe webhook delayed 6 h | Subscription state stale; nightly `payments-reconciler` cron re-syncs from Stripe. |
| Mass POS reconnect after offline (500 devices) | Sync queue spikes; `auto-shift-manager` processes within 2 min. |
| `audit_logs` index corruption | Reads fail; writes still succeed (DELETE/UPDATE policies = false anyway). REINDEX CONCURRENTLY. |

## Starter k6 script (POS record-sale)

```js
// scripts/load/record-sale.k6.js
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 10 },
    { duration: '2m',  target: 50 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<800', 'p(99)<2000'],
    http_req_failed:   ['rate<0.01'],
  },
};

const URL   = __ENV.MATBEX_URL;
const TOKEN = __ENV.MATBEX_JWT;

export default function () {
  const res = http.post(
    `${URL}/functions/v1/terminal-api/sales`,
    JSON.stringify({ items: [{ menu_item_id: __ENV.ITEM_ID, qty: 1 }] }),
    { headers: {
        Authorization: `Bearer ${TOKEN}`,
        'X-Terminal-Key': __ENV.TERMINAL_KEY,
        'Content-Type': 'application/json',
    }},
  );
  check(res, { 'status 200': (r) => r.status === 200 });
  sleep(1);
}
```

Run with `k6 run scripts/load/record-sale.k6.js` after setting env vars.

## Where to look during an incident

- `AdminEdgeFunctionHealth` (`/admin/edge-health`) — per-function p95 + error rate, last 24h.
- `AdminAuditLogs` (`/admin/audit`) — feature-flag and tenant mutations.
- Supabase Dashboard → Database → Reports — connection pool, slow queries.
- Upstash Console — Redis hit/miss rate.
