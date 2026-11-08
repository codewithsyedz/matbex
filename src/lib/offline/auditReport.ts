// =====================================================================
// Offline Audit Report aggregator
// ---------------------------------------------------------------------
// Reads everything in IndexedDB (orders, payments, invoices,
// cash-drawer events, sync queue, sync logs, failed items) and
// produces a per-day / per-shift summary including:
//   - offline event counts by entity type
//   - sync outcomes (synced / pending / failed)
//   - reconciliation totals (gross sales, payments collected,
//     cash drawer in/out, expected vs collected variance)
//
// Pure client-side; no network calls. Sensitive fields are decrypted
// only when needed for display (we only need totals here, so we read
// already-clear numeric fields off the payload).
// =====================================================================

import { getAll, STORES } from "./db";
import type { OfflineRecord, SyncQueueItem, OfflineStatus, EntityType } from "./types";
import { unprotectPayload } from "./crypto";

export interface ShiftSummary {
  shift_id: string | "unassigned";
  business_date: string;
  cashier_ids: string[];
  terminal_ids: string[];
  // Event counts
  orders: number;
  payments: number;
  invoices: number;
  cash_events: number;
  // Sync outcomes
  pending: number;
  syncing: number;
  synced: number;
  failed: number;
  // Reconciliation totals
  gross_sales: number;
  payments_collected: number;
  cash_in: number;       // open + drop
  cash_out: number;      // payout + close
  variance: number;      // collected - gross
  unpaid_orders: number;
  paid_orders: number;
  first_event_at: string | null;
  last_event_at: string | null;
}

export interface DaySummary {
  business_date: string;
  shifts: ShiftSummary[];
  totals: Omit<ShiftSummary, "shift_id" | "business_date" | "cashier_ids" | "terminal_ids" | "first_event_at" | "last_event_at"> & {
    cashier_ids: string[];
    terminal_ids: string[];
  };
}

export interface AuditReport {
  generated_at: string;
  total_records: number;
  queue_depth: number;
  failed_queue_items: number;
  days: DaySummary[];
  // Flat lists for raw inspection / CSV export
  raw: {
    orders: OfflineRecord[];
    payments: OfflineRecord[];
    cash_events: OfflineRecord[];
    queue: SyncQueueItem[];
  };
}

function emptyShift(date: string, shift: string): ShiftSummary {
  return {
    shift_id: shift,
    business_date: date,
    cashier_ids: [],
    terminal_ids: [],
    orders: 0,
    payments: 0,
    invoices: 0,
    cash_events: 0,
    pending: 0,
    syncing: 0,
    synced: 0,
    failed: 0,
    gross_sales: 0,
    payments_collected: 0,
    cash_in: 0,
    cash_out: 0,
    variance: 0,
    unpaid_orders: 0,
    paid_orders: 0,
    first_event_at: null,
    last_event_at: null,
  };
}

function track(set: string[], v: string | null | undefined) {
  if (v && !set.includes(v)) set.push(v);
}

function tallyStatus(b: ShiftSummary, s: OfflineStatus) {
  if (s === "PENDING") b.pending++;
  else if (s === "SYNCING") b.syncing++;
  else if (s === "SYNCED") b.synced++;
  else if (s === "FAILED" || s === "FAILED_VALIDATION") b.failed++;
}

function pushTime(b: ShiftSummary, iso: string) {
  if (!b.first_event_at || iso < b.first_event_at) b.first_event_at = iso;
  if (!b.last_event_at || iso > b.last_event_at) b.last_event_at = iso;
}

/** Build the full audit report from local IndexedDB data. */
export async function buildAuditReport(): Promise<AuditReport> {
  const [orders, payments, invoices, cashEvents, queue, failed] = await Promise.all([
    getAll<OfflineRecord>(STORES.orders),
    getAll<OfflineRecord>(STORES.payments),
    getAll<OfflineRecord>(STORES.invoices),
    getAll<OfflineRecord>(STORES.cashDrawer),
    getAll<SyncQueueItem>(STORES.queue),
    getAll<SyncQueueItem>(STORES.failed),
  ]);

  // bucket: business_date -> shift_id -> ShiftSummary
  const buckets = new Map<string, Map<string, ShiftSummary>>();
  const getBucket = (date: string, shift: string): ShiftSummary => {
    let day = buckets.get(date);
    if (!day) {
      day = new Map();
      buckets.set(date, day);
    }
    let s = day.get(shift);
    if (!s) {
      s = emptyShift(date, shift);
      day.set(shift, s);
    }
    return s;
  };

  // ORDERS - also drives gross sales + paid/unpaid counts
  for (const o of orders) {
    const decoded: any = await unprotectPayload(o.payload);
    const shiftId = decoded?.shift_id ?? "unassigned";
    const b = getBucket(o.business_date, shiftId);
    b.orders++;
    tallyStatus(b, o.status);
    track(b.cashier_ids, o.cashier_id);
    track(b.terminal_ids, o.terminal_id);
    pushTime(b, o.created_at);
    const total = Number(decoded?.total ?? 0);
    b.gross_sales += total;
    if (decoded?.settlement_status === "unpaid") b.unpaid_orders++;
    else b.paid_orders++;
  }

  // PAYMENTS - drives money actually collected
  for (const p of payments) {
    const decoded: any = await unprotectPayload(p.payload);
    const shiftId = decoded?.shift_id ?? "unassigned";
    const b = getBucket(p.business_date, shiftId);
    b.payments++;
    tallyStatus(b, p.status);
    track(b.cashier_ids, p.cashier_id);
    track(b.terminal_ids, p.terminal_id);
    pushTime(b, p.created_at);
    b.payments_collected += Number(decoded?.amount ?? 0);
  }

  // INVOICES - counts only
  for (const inv of invoices) {
    const shiftId = (inv.payload as any)?.shift_id ?? "unassigned";
    const b = getBucket(inv.business_date, shiftId);
    b.invoices++;
    tallyStatus(b, inv.status);
    pushTime(b, inv.created_at);
  }

  // CASH DRAWER - in/out and shift open/close
  for (const c of cashEvents) {
    const decoded: any = await unprotectPayload(c.payload);
    const shiftId = decoded?.shift_id ?? "unassigned";
    const b = getBucket(c.business_date, shiftId);
    b.cash_events++;
    tallyStatus(b, c.status);
    track(b.cashier_ids, c.cashier_id);
    track(b.terminal_ids, c.terminal_id);
    pushTime(b, c.created_at);
    const amt = Number(decoded?.amount ?? 0);
    if (decoded?.event_type === "open" || decoded?.event_type === "drop") b.cash_in += amt;
    else if (decoded?.event_type === "close" || decoded?.event_type === "payout") b.cash_out += amt;
  }

  // Compute variance + roll up day totals
  const days: DaySummary[] = [];
  for (const [date, dayMap] of buckets) {
    const shifts = Array.from(dayMap.values()).map((s) => ({
      ...s,
      variance: +(s.payments_collected - s.gross_sales).toFixed(2),
    }));
    shifts.sort((a, b) => (a.first_event_at ?? "").localeCompare(b.first_event_at ?? ""));
    const totals = shifts.reduce(
      (acc, s) => {
        acc.orders += s.orders;
        acc.payments += s.payments;
        acc.invoices += s.invoices;
        acc.cash_events += s.cash_events;
        acc.pending += s.pending;
        acc.syncing += s.syncing;
        acc.synced += s.synced;
        acc.failed += s.failed;
        acc.gross_sales += s.gross_sales;
        acc.payments_collected += s.payments_collected;
        acc.cash_in += s.cash_in;
        acc.cash_out += s.cash_out;
        acc.unpaid_orders += s.unpaid_orders;
        acc.paid_orders += s.paid_orders;
        s.cashier_ids.forEach((c) => track(acc.cashier_ids, c));
        s.terminal_ids.forEach((t) => track(acc.terminal_ids, t));
        return acc;
      },
      {
        orders: 0, payments: 0, invoices: 0, cash_events: 0,
        pending: 0, syncing: 0, synced: 0, failed: 0,
        gross_sales: 0, payments_collected: 0, cash_in: 0, cash_out: 0,
        variance: 0, unpaid_orders: 0, paid_orders: 0,
        cashier_ids: [] as string[], terminal_ids: [] as string[],
      },
    );
    totals.variance = +(totals.payments_collected - totals.gross_sales).toFixed(2);
    days.push({ business_date: date, shifts, totals });
  }
  days.sort((a, b) => b.business_date.localeCompare(a.business_date));

  return {
    generated_at: new Date().toISOString(),
    total_records: orders.length + payments.length + invoices.length + cashEvents.length,
    queue_depth: queue.filter((q) => q.status !== "SYNCED").length,
    failed_queue_items: failed.length,
    days,
    raw: { orders, payments, cash_events: cashEvents, queue },
  };
}

/** Convert the per-shift breakdown to a CSV string for download. */
export function reportToCsv(report: AuditReport): string {
  const headers = [
    "business_date", "shift_id", "cashiers", "terminals",
    "orders", "payments", "invoices", "cash_events",
    "synced", "pending", "failed", "syncing",
    "paid_orders", "unpaid_orders",
    "gross_sales", "payments_collected", "cash_in", "cash_out", "variance",
    "first_event_at", "last_event_at",
  ];
  const rows: string[] = [headers.join(",")];
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  for (const day of report.days) {
    for (const s of day.shifts) {
      rows.push([
        s.business_date, s.shift_id,
        s.cashier_ids.join("|"), s.terminal_ids.join("|"),
        s.orders, s.payments, s.invoices, s.cash_events,
        s.synced, s.pending, s.failed, s.syncing,
        s.paid_orders, s.unpaid_orders,
        s.gross_sales.toFixed(2), s.payments_collected.toFixed(2),
        s.cash_in.toFixed(2), s.cash_out.toFixed(2), s.variance.toFixed(2),
        s.first_event_at ?? "", s.last_event_at ?? "",
      ].map(esc).join(","));
    }
  }
  return rows.join("\n");
}