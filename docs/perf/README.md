# Performance reports

Soak-test output from `scripts/sync-soak.mjs` (Epic E2). Each run drops a
timestamped Markdown report here so we can compare deployments over time.

## Latest baseline

Run against a scratch tenant with a paired cashier JWT:

```bash
SUPABASE_URL=... SUPABASE_ANON_KEY=... E2E_JWT=... E2E_BRANCH_ID=... \
  node scripts/sync-soak.mjs --terminals=10 --tps=5 --minutes=5
```

### Targets

| Metric | Target |
| --- | --- |
| p50 latency | < 150 ms |
| p95 latency | < 400 ms |
| p99 latency | < 1500 ms |
| Error rate | < 0.5% |
| Sustained events/s | ≥ 250 (10 term × 5 tps × 5 batch) |

Regressions below these thresholds must be investigated before shipping to
production tenants.