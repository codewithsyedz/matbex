# RILAN Enterprise Offline-First POS Architecture

**Owner:** RILAN Business Company (Smoke Grill, Karahi GUYZ — branches: Sulai, Al-Wadi)
**Status:** Architecture blueprint — v1.0
**Foundation:** Extends the existing Matbex offline layer (`src/lib/offline/*`, `public/sw-pos-sync.js`, `supabase/functions/terminal-api/*`).

This document is the canonical design for the RILAN offline-first POS. Where the current codebase already implements a capability, it is called out inline — new work must extend those primitives rather than replace them.

---

## 1. Guiding Principles

1. **Offline is the default runtime.** Cloud connectivity is an enhancement, not a prerequisite. Every cashier-facing screen must reach an interactive state within 100 ms of a tap even with the WAN link down.
2. **Local writes are authoritative until acknowledged.** Mutations commit to IndexedDB / SQLite first, get a device-scoped UUID + monotonic `version`, then queue for the cloud.
3. **Every business action is an immutable event.** Ledger, audit trail, ZATCA chain are append-only. Corrections are compensating events.
4. **Idempotency everywhere.** Every write carries `Idempotency-Key` (enforced by `supabase/functions/terminal-api` + `pos_idempotency_keys`). Retries never double-post.
5. **Tenant + branch isolation is non-negotiable.** RLS scopes every table by `tenant_id` / `restaurant_id`; the sync engine tags every record with `branch_id` + `terminal_id` before queueing.
6. **Zero data loss over zero latency.** If forced to choose between dropping a byte and rejecting a write, we reject.

---

## 2. System Context (C4 L1)

```text
                    ┌────────────────────────────────────┐
                    │        RILAN Cloud (Lovable)       │
                    │  Supabase Postgres · Edge Fns ·    │
                    │  Storage · Realtime · AI Gateway   │
                    └────────────────┬───────────────────┘
                                     │  HTTPS / WSS (TLS 1.3)
                                     │  JWT + terminal device-key
                                     ▼
  ┌───────────────────────  Branch LAN  ────────────────────────┐
  │  ┌───────────┐  ┌───────────┐  ┌────────────────┐           │
  │  │ POS Term A│  │ POS Term B│  │ Manager Tablet │           │
  │  └─────┬─────┘  └─────┬─────┘  └────────┬───────┘           │
  │        ▼              ▼                 ▼                    │
  │           ┌──────────────────────────┐                       │
  │           │  Local Branch Gateway    │  ◀── new (§4)         │
  │           │  Node/Deno · mDNS        │                       │
  │           │  • local API mirror      │                       │
  │           │  • WebSocket fan-out     │                       │
  │           │  • SQLite (LiteFS)       │                       │
  │           │  • cloud sync bridge     │                       │
  │           └──────────┬───────────────┘                       │
  │  ┌────────────┐      │      ┌──────────────┐                 │
  │  │ Kitchen KDS│◀─────┼─────▶│ QR / Kiosk   │                 │
  │  └────────────┘      ▼      └──────────────┘                 │
  │              Thermal Printers · Cash Drawer                  │
  └──────────────────────────────────────────────────────────────┘
```

Actors: Cashier, Waiter, Kitchen, Manager, Owner, Accountant, Guest (QR), ZATCA, Payment Gateways.

---

## 3. Terminal Runtime (already shipped)

| Concern | Module | Notes |
|---|---|---|
| IndexedDB schema | `src/lib/offline/db.ts` | Stores: orders, payments, invoices, returns, cash_drawer, sync_queue, sync_logs, failed_sync_items, kv |
| Device identity | `terminal.ts`, `deviceFingerprint.ts` | Persistent `terminal_id`, paired via `pos_terminals` + `pos_terminal_pairing_codes` |
| Connectivity | `connectivity.ts` | Health-probe driven: `online / offline / syncing / sync-failed` |
| Sync engine | `syncEngine.ts` | FIFO w/ dependency ordering, retry, DLQ, tenant guard tests |
| Crypto | `crypto.ts` | AES-GCM per-device key; strips PAN/CVV before persist |
| Background sync | `backgroundSync.ts` + `public/sw-pos-sync.js` | Service Worker drains queue tab-closed via Sync + Periodic Sync APIs |
| Retry policy | `retryPolicy.ts`, `errorCategorization.ts` | Categorised: transient / validation / auth / conflict |
| Public API | `posService.ts` | Consumed by `RecordSale`, `Shifts`, `Returns` |

Layered on top (new):

1. **Monotonic version vector per record.** `version = { device_id, lamport }`. Server uses the pair for concurrent-write detection (§9).
2. **Row-level checksums.** SHA-256 of canonical JSON, re-verified on unpack. Mismatch → `failed_sync_items` with `reason='checksum_mismatch'`.
3. **Menu / customer / pricing cache.** New stores: `cache_menu`, `cache_customers`, `cache_pricing`, `cache_receipt_templates`, `cache_tax_config`, `cache_zatca_config`. Refreshed via Supabase Realtime while online; REST-on-boot fallback.
4. **Local event log.** New append-only IndexedDB store `event_log` (keyed by `event_id`) becomes source of truth; `sync_queue` is a derived index.

---

## 4. Local Branch Gateway (new)

Small process (Node 20 / Deno) on a Mini-PC or on the manager tablet in "gateway mode". Discovered by terminals via mDNS (`_rilan-pos._tcp.local`).

Responsibilities:
- Terminate LAN WebSockets so terminals fan-out to each other in <10 ms even with WAN down (KDS tickets, table status, reprints).
- Mirror hot tables (`menu_items`, `pos_tables`, `receipt_templates`, `inventory_items` snapshot, `customers` last 90 d) into on-disk SQLite (LiteFS) for fast cold boot.
- Multiplex outbound sync: batch queue items from all terminals, dedupe by `idempotency_key`, call cloud edge functions on their behalf.
- Local health endpoint terminals hit when WAN probe fails (`connectivity.ts` gains `localHealthUrl`).
- Cache ZATCA CSIDs + last invoice hash so chain stays intact offline.

Optional — a single terminal must still function stand-alone.

---

## 5. Cloud Platform (additions)

- **`POST /terminal-api/sync`** batch endpoint accepting typed events. Back-compat with existing per-entity endpoints.
- **Event Bus.** Postgres `LISTEN/NOTIFY` + Supabase Realtime for internal fan-out (finance, analytics, inventory). Every ingested event writes `event_log_v2` (immutable) before touching domain tables.
- **Snapshot service.** Nightly per-tenant `menu_snapshot.json.gz` in Storage; gateways fetch in one round-trip on boot.
- **Analytics warehouse.** Keep `daily_sales_summary`, `daily_profit_state`; add materialised views for branch-scoped KPIs.

---

## 6. Per-Record Contract

```ts
{
  id: string;                  // UUIDv7
  tenant_id: string;
  branch_id: string;
  terminal_id: string;
  created_by: string;
  created_at: string;          // ISO, device clock
  server_received_at: string | null;
  updated_at: string;
  version: { device: string; lamport: number };
  checksum: string;            // sha256(canonical(payload))
  status: 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED' | 'FAILED_VALIDATION';
  soft_deleted_at: string | null;
  payload: T;                  // sensitive fields encrypted via crypto.ts
}
```

---

## 7. Event Catalogue (append-only)

```
OrderCreated / OrderUpdated / OrderVoided / OrderPaid
ItemAdded / ItemRemoved / ModifierApplied / DiscountApplied
PaymentAuthorized / PaymentCaptured / PaymentRefunded / PaymentVoided
InventoryReserved / InventoryDeducted / InventoryReturned / WasteRecorded
ShiftOpened / ShiftClosed / CashDrop / CashCount / DrawerOpened
KitchenTicketFired / KitchenTicketReady / KitchenTicketServed
CustomerCreated / LoyaltyEarned / LoyaltyRedeemed
ReceiptPrinted / ZatcaInvoiceStamped / ZatcaInvoiceSubmitted
TableOpened / TableTransferred / TableClosed
DriverAssigned / DeliveryPickedUp / DeliveryDelivered
```

Contract: `{ event_id, event_type, occurred_at, tenant_id, branch_id, terminal_id, actor, payload, causation_id?, correlation_id? }`.

---

## 8. Sync State Machine

```text
PENDING → QUEUED → SYNCING → SYNCED → CONFIRMED → ARCHIVED (30d)
                       │
                       ├── 409 conflict         → CONFLICT (§10)
                       ├── 4xx validation       → FAILED_VALIDATION (manual)
                       └── 5xx/network          → RETRY (backoff)
   checksum / card-data                         → QUARANTINE
```

Backoff: 1s, 5s, 15s, 1m, 5m, 15m, 1h → DLQ. DLQ entry notifies owner (existing `in_app_notifications` + WhatsApp).

---

## 9. Conflict Detection

Server enforces:
- **Idempotency-Key uniqueness** (existing `pos_idempotency_keys`).
- **Version vector check** — reject if incoming `lamport <= stored.lamport` from a different device without merge intent.
- **Business invariants** — shift-open before sale; inventory ≥ 0 unless `allow_negative_stock` flag; payment total = order total.

Every conflict writes `audit_logs` + `pos_terminal_audit` and returns a structured error the client can act on.

---

## 10. Conflict Resolution

Strategies configurable per entity via `feature_flags`:

| Entity | Default strategy |
|---|---|
| Order header | Server authority |
| Order items pre-payment | Merge (union by `line_id`) |
| Menu / pricing | Server authority always |
| Inventory delta | Additive (sum of deltas, never overwrite absolute) |
| Customer profile | Field-level LWW; manager approval for tier changes |
| Shift close | First-writer-wins + variance flag on second attempt |
| Payments | Idempotency-Key only; duplicates rejected, never merged |

All resolutions emit a compensating event so history is preservable.

---

## 11. Payment Resilience

- **Cash / wallet / gift card / loyalty:** fully offline; recorded locally, synced via `sync_queue`.
- **Card (integrated):** requires online auth. Offline options: (a) take cash, (b) mark as `external_card_recorded` (existing `payment_txn_kind`) with the reader's reference, or (c) if gateway supports store-and-forward (HyperPay/Geidea offline), queue an encrypted auth blob for later capture. PAN/CVV never touch disk.
- **Duplicate prevention:** `idempotency_key = hash(order_id + amount + method + terminal_ts)`; server rejects duplicates with `409 duplicate_payment`.

---

## 12. Security

- TLS 1.3, HSTS, cert pinning on Capacitor build.
- Device pairing: 6-digit code → device-key (existing `pos_terminal_pairing_codes` / `create_pairing_code`). Rotated every 30 d or on revoke.
- Auth: Supabase JWT (human) + `X-Terminal-Key` (device) — both required on every write.
- MFA for `owner`, `superadmin`, `accountant`.
- Local storage: AES-256-GCM for sensitive fields, non-extractable `CryptoKey` (already in `crypto.ts`).
- Root/jailbreak detection on Android.
- Impersonation write-guard (shipped) blocks writes during "Test as…".
- RLS contract tests gate every new tenant-scoped table.

---

## 13. Observability

Extend `/admin/edge-health`:
- Sync queue depth per branch / terminal
- Sync lag p50/p95/p99
- Failed-sync rate + top error categories
- Devices last-seen heatmap
- Inventory drift (local snapshot vs cloud)
- Payment reconciliation status
- ZATCA chain gaps
- Cold-start counts, edge fn p95 (existing `withMetrics()`)

Alerting: in-app + owner WhatsApp (`owner_whatsapp_subscriptions`, `kpi_alerts`).

---

## 14. Failure Playbook

| Scenario | Detection | Auto recovery | Human action |
|---|---|---|---|
| WAN outage | `connectivity.ts` fails | Local queue continues; gateway LAN fan-out | None <72 h |
| Cloud outage | Edge fn 5xx | Backoff retry; DLQ at ceiling | Status page + WhatsApp |
| Branch gateway crash | Terminal loses mDNS | Terminals fall back to direct cloud (or peer election) | Restart service |
| Terminal crash | Session lost | `syncEngine` resumes from IndexedDB on relaunch | None |
| Power loss mid-write | IndexedDB tx aborts | `openDB()` repairs; corrupt rows quarantined | Review quarantine |
| DB corruption | Checksum mismatch | Row quarantined; backup restored | Manager approves rebuild |
| Payment gateway outage | Provider 5xx | Fallback to cash / external-card | Reconcile EOD |
| Duplicate submission | Idempotency-Key hit | Server returns cached response | None |
| Printer offline | Print timeout | `printQueue.ts` retries; PDF fallback | Swap printer |
| KDS outage | WS drop | Manager tablet becomes fallback KDS | Restart display |

See `docs/runbook-incident-response.md` for operator steps.

---

## 15. Performance Targets

| Metric | Target |
|---|---|
| Tap → UI feedback | <100 ms p95 |
| Local write → IndexedDB commit | <30 ms p95 |
| Sync latency (online, per event) | <250 ms p95 |
| Offline endurance | ≥72 h |
| Menu boot from cache | <500 ms |
| Branch count | 10 000+ |
| Terminals | 250 000+ |
| Daily events | 10⁸ order of magnitude |
| Cloud availability | 99.99 % |
| Data loss budget | 0 |

Bundle budget (CI): initial JS ≤ 250 KB gzip.

---

## 16. Testing Strategy

- **Unit** — reducers / retry / conflict rules (vitest, existing setup).
- **Contract** — RLS coverage audit (`src/lib/__tests__/rlsCoverageAudit.test.ts`); extend to sync payloads.
- **Integration** — Playwright driving preview with network toggled via CDP `Network.emulateNetworkConditions`.
- **Sync soak** — 24 h synthetic 50 terminals × 5 tps.
- **Chaos** — kill branch gateway mid-batch; assert no lost events.
- **Disaster drill** — quarterly restore-from-backup (`docs/runbook-load-and-chaos.md`).

---

## 17. Rollout Plan

**Phase 1 — foundation (mostly shipped).** IndexedDB stores, sync engine, background SW, terminal pairing, idempotency, retry policy, crypto.

**Phase 2 — this blueprint.** Version vectors + checksums on every row. Consolidated `POST /terminal-api/sync` batch endpoint. Menu / pricing / customer local caches with Realtime refresh. Sync observability dashboard.

**Phase 3 — branch gateway.** LBG MVP (single-tenant, mDNS, LAN WS). Snapshot service + fast boot. ZATCA offline chain hardening.

**Phase 4 — expansion.** Multi-region cloud (data-region guard via `guard_tenant_data_region` exists). Store-and-forward card capture with certified gateways. Franchise / multi-country.

---

## 18. Technical Decision Records

- **TDR-001** IndexedDB over WebSQL/localStorage — durability + structured queries.
- **TDR-002** UUIDv7 over UUIDv4 — time-ordered, better index locality.
- **TDR-003** Idempotency-Key on every write — non-negotiable for at-least-once delivery.
- **TDR-004** Additive inventory deltas over absolute snapshots — offline merges become commutative.
- **TDR-005** Server authority for menu/pricing — prices must never drift.
- **TDR-006** Local Branch Gateway is optional — single-terminal branches must remain fully functional.
- **TDR-007** Card data never persisted locally — even encrypted. External-card path or provider store-and-forward only.
- **TDR-008** Append-only event log is source of truth — domain tables are projections and can be rebuilt.

---

## 19. Open Questions

1. Mandate the Local Branch Gateway for branches with ≥3 terminals, or leave opt-in?
2. Which certified providers integrate for KSA offline card store-and-forward (HyperPay, Geidea, Amazon PS)?
3. ZATCA Phase 2 clearance requires online submission within 24 h — hard block at 20 h offline, or warning only?
4. Multi-region: single Supabase project with sharding vs project-per-region?
