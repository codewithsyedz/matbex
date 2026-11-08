# Phase 2 — Offline-First POS Implementation Tickets

Companion to `docs/architecture/offline-first-pos.md`. Each ticket is sized to
one PR, has a clear acceptance test, and lists the exact files to touch.

Legend: **S** ≈ 0.5 d · **M** ≈ 1–2 d · **L** ≈ 3–5 d.

---

## Epic A — Row-level integrity (version vectors + checksums)

### A1. Add `version` + `checksum` to `OfflineRecord`  · S
- **Files:** `src/lib/offline/types.ts`, `src/lib/offline/db.ts` (bump `DB_VERSION` to 2, migrate rows: default `version = { device, lamport: 1 }`, checksum recomputed on read-miss).
- **Contract:** `version: { device: string; lamport: number }`, `checksum: string` (sha256 hex of canonical JSON of `payload`).
- **Accept:** existing IDB rows load without error; new writes include both fields; unit test in `src/lib/offline/__tests__/`.

### A2. Canonical JSON + checksum helper  · S
- **New file:** `src/lib/offline/checksum.ts` — stable key ordering + sha256 via `crypto.subtle.digest`.
- **Accept:** vitest snapshot for a fixed payload.

### A3. Lamport clock per device  · S
- **New file:** `src/lib/offline/lamport.ts` — monotonic counter persisted in `kv` (`pos.lamport`), `next()` returns and persists.
- **Accept:** survives reload; never regresses.

### A4. Wire A1–A3 into `posService` writes  · M
- **File:** `src/lib/offline/posService.ts` — every enqueue stamps `version` + `checksum`.
- **Accept:** e2e — record a sale offline, inspect IDB row, both fields populated.

### A5. Server-side version-vector check  · M
- **Files:** `supabase/functions/terminal-api/*` (sales/shifts/payments handlers).
- **Rule:** reject with `409 stale_version` if incoming `lamport <= stored.lamport` from a different `device`.
- **Accept:** edge-function test in `supabase--test_edge_functions`.

---

## Epic B — Batch sync endpoint

### B1. `POST /terminal-api/sync` skeleton  · M
- **New file:** `supabase/functions/terminal-api/sync/index.ts` — accepts `{ events: TypedEvent[] }`, dispatches per-type to existing handlers, returns per-event result array preserving order.
- **Auth:** JWT + `X-Terminal-Key` (reuse existing middleware).
- **Idempotency:** batch-level `Idempotency-Key` header + per-event key; server dedupes both.
- **Accept:** curl-based smoke via `supabase--curl_edge_functions`.

### B2. Typed event schema (zod)  · S
- **New file:** `supabase/functions/terminal-api/_shared/events.ts` — discriminated union for the events in §7 of the blueprint (start with Order/Payment/Shift/Cash).
- **Accept:** invalid event → `400` with field errors.

### B3. Client-side batcher  · M
- **File:** `src/lib/offline/syncEngine.ts` — drain up to N (default 25) queue items into one `sync` call; keep single-endpoint fallback behind a feature flag `offline_batch_sync`.
- **Accept:** offline soak — 100 queued events → 4 batched calls.

### B4. Feature flag + rollout switch  · S
- **File:** `feature_flags` (migration adds `offline_batch_sync` default `false`).
- **Accept:** flag off → old path, flag on → batched path; both green in CI.

---

## Epic C — Local caches (menu / pricing / customers)

### C1. New IDB stores  · S
- **File:** `src/lib/offline/db.ts` — add `cache_menu`, `cache_pricing`, `cache_customers`, `cache_receipt_templates`, `cache_tax_config`, `cache_zatca_config`. Keyed by natural id; index on `updated_at`.
- **Accept:** DB upgrade path unit-tested.

### C2. Cache hydrator  · M
- **New file:** `src/lib/offline/cacheHydrator.ts` — on boot, if online, pull deltas since `kv['cache.<name>.since']`. Reuses existing hooks (`useMenuItems`, `useBranchPrices`).
- **Accept:** cold-boot from cache in <500 ms with network disabled.

### C3. Realtime refresh  · M
- **New file:** `src/lib/offline/cacheRealtime.ts` — subscribe to `postgres_changes` on the cached tables; update IDB rows; teardown on unmount.
- **Accept:** edit a menu item in cloud → local cache updates within 2 s.

### C4. Read-through in hooks  · M
- **Files:** `src/hooks/useMenuItems.ts`, `src/hooks/useBranchPrices.ts`, plus any customer lookup used in POS.
- **Rule:** if online → network, else → IDB cache.
- **Accept:** Playwright — kill network, menu still renders.

---

## Epic D — Sync health & observability

### D1. Sync metrics collector  · S
- **New file:** `src/lib/offline/metrics.ts` — counters: `queue_depth`, `sync_success`, `sync_failed`, `sync_latency_ms`. Emits to `edge_function_metrics` via existing `withMetrics()` on cloud side; page side uses `sync_logs` store.
- **Accept:** metrics visible in dev console.

### D2. `/admin/sync-health` dashboard  · L
- **New files:** `src/pages/admin/SyncHealth.tsx`, route in `AnimatedRoutes.tsx`.
- **Widgets:** queue depth per branch, sync lag p50/p95, failed-sync rate, devices last-seen, top error categories.
- **Data source:** existing `edge_function_metrics` + new view `sync_health_v1` (migration).
- **Accept:** loads under 2 s; charts respect `activeBranchId`.

### D3. Owner alert on DLQ  · S
- **Files:** existing `in_app_notifications` + `owner_whatsapp_subscriptions` pipeline; trigger on `failed_sync_items` insert.
- **Accept:** simulate a poisoned event → owner receives alert.

---

## Epic E — Test coverage

### E1. Playwright offline scenario  · M
- **New file:** `e2e/offline-sale.spec.ts` (drive via `code--exec` per project convention).
- **Flow:** login → open shift → toggle CDP offline → record 3 sales → toggle online → assert all 3 land in cloud with matching idempotency keys.

### E2. Sync soak harness  · M
- **New file:** `scripts/sync-soak.mjs` — spawns N virtual terminals hitting the batch endpoint at X tps for T minutes.
- **Accept:** run report checked into `docs/perf/`.

### E3. Chaos test — kill mid-batch  · S
- **New file:** `src/lib/offline/__tests__/syncEngine.chaos.test.ts` — simulate abort after N events, assert resume from lamport N+1.

---

## Suggested order

Ship A → B → C → D → E in that order. A gates B (server needs versions); B unlocks D (batch metrics are cheaper); C is independent and can run in parallel with B by a second engineer.

Rough calendar for one engineer: **~4 weeks** for A+B, **+2 weeks** for C, **+1 week** for D, **+1 week** for E. Two engineers in parallel: ~5 weeks total.
