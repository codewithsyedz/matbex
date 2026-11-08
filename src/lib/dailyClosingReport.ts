/**
 * Branch-wise daily closing report.
 *
 * Pure builder that merges the three sources of truth for a closed day:
 *   1. `sales_transactions` — raw POS receipts (VAT-inclusive `total`)
 *   2. `daily_sales_summary` — the operator's declared close for the day
 *   3. `day_end_adjustments`  — active (non-reversed) cash reconciliation deltas
 *
 * Output is one row per (branch, business day) with totals, VAT split, cash
 * breakdown and reconciliation deltas — consumed by the CSV and PDF exports.
 */

import { formatZonedYMD } from "@/lib/timezone";

export interface ClosingTxRow {
  branch_id: string | null;
  created_at: string;
  total: number | string | null;
  subtotal?: number | string | null;
  tax?: number | string | null;
  payment_method?: string | null;
  is_delivery?: boolean | null;
}

export interface ClosingSummaryRow {
  branch_id: string | null;
  sales_date: string;
  total_sales: number | string | null;
  cash_sales?: number | string | null;
  card_sales?: number | string | null;
  delivery_sales?: number | string | null;
  other_sales?: number | string | null;
  pos_reported_total?: number | string | null;
  system_calculated_total?: number | string | null;
  variance_amount?: number | string | null;
  variance_status?: string | null;
  status?: string | null;
}

export interface ClosingAdjustmentRow {
  branch_id: string | null;
  business_date: string;
  amount: number | string | null;
  reversed_at?: string | null;
  reversal_of_id?: string | null;
}

export interface ClosingReportRow {
  branchId: string | null;
  branchName: string;
  date: string;
  txCount: number;
  /** VAT-inclusive POS total. */
  gross: number;
  /** Net of VAT. */
  net: number;
  vat: number;
  cash: number;
  card: number;
  delivery: number;
  other: number;
  /** Net of active day-end adjustments. */
  adjustments: number;
  /** `daily_sales_summary.total_sales` when the day was closed. */
  declared: number | null;
  posReported: number | null;
  /** declared − (gross + adjustments). Zero when fully reconciled. */
  delta: number;
  status: "closed" | "adjusted" | "open";
  varianceStatus: string | null;
}

export interface ClosingReportTotals {
  txCount: number;
  gross: number;
  net: number;
  vat: number;
  cash: number;
  card: number;
  delivery: number;
  other: number;
  adjustments: number;
  declared: number;
  delta: number;
}

const num = (v: unknown) => Number(v ?? 0) || 0;
const r2 = (n: number) => {
  const v = Math.round(n * 100) / 100;
  return v === 0 ? 0 : v;
};
const keyOf = (branchId: string | null, date: string) => `${branchId ?? "__none__"}|${date}`;

export function buildClosingReport(input: {
  txRows: ClosingTxRow[];
  summaryRows: ClosingSummaryRow[];
  adjRows: ClosingAdjustmentRow[];
  branchNames: Map<string, string>;
  timeZone?: string;
}): { rows: ClosingReportRow[]; totals: ClosingReportTotals } {
  const { txRows, summaryRows, adjRows, branchNames } = input;
  const timeZone = input.timeZone || "Asia/Riyadh";

  const map = new Map<string, ClosingReportRow>();
  const ensure = (branchId: string | null, date: string): ClosingReportRow => {
    const k = keyOf(branchId, date);
    let row = map.get(k);
    if (!row) {
      row = {
        branchId,
        branchName: (branchId && branchNames.get(branchId)) || "Unassigned",
        date,
        txCount: 0,
        gross: 0,
        net: 0,
        vat: 0,
        cash: 0,
        card: 0,
        delivery: 0,
        other: 0,
        adjustments: 0,
        declared: null,
        posReported: null,
        delta: 0,
        status: "open",
        varianceStatus: null,
      };
      map.set(k, row);
    }
    return row;
  };

  for (const t of txRows || []) {
    const date = formatZonedYMD(new Date(t.created_at), timeZone);
    const row = ensure(t.branch_id ?? null, date);
    const gross = num(t.total);
    const vat = num(t.tax);
    const net = t.subtotal != null ? num(t.subtotal) : gross - vat;
    row.txCount += 1;
    row.gross += gross;
    row.vat += vat;
    row.net += net;
    if (t.is_delivery) row.delivery += gross;
    else if (t.payment_method === "cash") row.cash += gross;
    else if (t.payment_method === "card") row.card += gross;
    else row.other += gross;
  }

  for (const a of adjRows || []) {
    if (a.reversed_at || a.reversal_of_id) continue;
    const row = ensure(a.branch_id ?? null, a.business_date);
    row.adjustments += num(a.amount);
  }

  for (const s of summaryRows || []) {
    const row = ensure(s.branch_id ?? null, s.sales_date);
    row.declared = num(s.total_sales);
    row.posReported = s.pos_reported_total != null ? num(s.pos_reported_total) : null;
    row.varianceStatus = s.variance_status ?? null;
    // Prefer the operator's declared payment split when the day is closed.
    if (s.cash_sales != null || s.card_sales != null) {
      row.cash = num(s.cash_sales);
      row.card = num(s.card_sales);
      row.delivery = num(s.delivery_sales);
      row.other = num(s.other_sales);
    }
  }

  const rows = Array.from(map.values()).map((row) => {
    row.gross = r2(row.gross);
    row.net = r2(row.net);
    row.vat = r2(row.vat);
    row.cash = r2(row.cash);
    row.card = r2(row.card);
    row.delivery = r2(row.delivery);
    row.other = r2(row.other);
    row.adjustments = r2(row.adjustments);
    row.declared = row.declared == null ? null : r2(row.declared);
    row.status =
      row.declared != null ? "closed" : row.adjustments !== 0 ? "adjusted" : "open";
    row.delta =
      row.declared == null ? 0 : r2(row.declared - (row.gross + row.adjustments));
    return row;
  });

  rows.sort(
    (a, b) => a.date.localeCompare(b.date) || a.branchName.localeCompare(b.branchName),
  );

  const totals = rows.reduce<ClosingReportTotals>(
    (acc, r) => ({
      txCount: acc.txCount + r.txCount,
      gross: r2(acc.gross + r.gross),
      net: r2(acc.net + r.net),
      vat: r2(acc.vat + r.vat),
      cash: r2(acc.cash + r.cash),
      card: r2(acc.card + r.card),
      delivery: r2(acc.delivery + r.delivery),
      other: r2(acc.other + r.other),
      adjustments: r2(acc.adjustments + r.adjustments),
      declared: r2(acc.declared + (r.declared ?? 0)),
      delta: r2(acc.delta + r.delta),
    }),
    {
      txCount: 0,
      gross: 0,
      net: 0,
      vat: 0,
      cash: 0,
      card: 0,
      delivery: 0,
      other: 0,
      adjustments: 0,
      declared: 0,
      delta: 0,
    },
  );

  return { rows, totals };
}

export const CLOSING_REPORT_HEADERS = [
  "Date",
  "Branch",
  "Receipts",
  "Net (excl. VAT)",
  "VAT",
  "Gross (incl. VAT)",
  "Cash",
  "Card",
  "Delivery",
  "Other",
  "Day-end adjustments",
  "Declared total",
  "POS reported",
  "Reconciliation delta",
  "Status",
] as const;

const csvCell = (v: string | number) =>
  typeof v === "number" ? String(v) : `"${v.replace(/"/g, '""')}"`;

export function closingReportToRows(rows: ClosingReportRow[]): (string | number)[][] {
  return rows.map((r) => [
    r.date,
    r.branchName,
    r.txCount,
    r.net.toFixed(2),
    r.vat.toFixed(2),
    r.gross.toFixed(2),
    r.cash.toFixed(2),
    r.card.toFixed(2),
    r.delivery.toFixed(2),
    r.other.toFixed(2),
    r.adjustments.toFixed(2),
    r.declared == null ? "" : r.declared.toFixed(2),
    r.posReported == null ? "" : r.posReported.toFixed(2),
    r.delta.toFixed(2),
    r.status,
  ]);
}

export function closingReportToCsv(
  rows: ClosingReportRow[],
  totals: ClosingReportTotals,
): string {
  const lines = [CLOSING_REPORT_HEADERS.map(csvCell).join(",")];
  for (const r of closingReportToRows(rows)) lines.push(r.map(csvCell).join(","));
  lines.push(
    [
      "TOTAL",
      "",
      totals.txCount,
      totals.net.toFixed(2),
      totals.vat.toFixed(2),
      totals.gross.toFixed(2),
      totals.cash.toFixed(2),
      totals.card.toFixed(2),
      totals.delivery.toFixed(2),
      totals.other.toFixed(2),
      totals.adjustments.toFixed(2),
      totals.declared.toFixed(2),
      "",
      totals.delta.toFixed(2),
      "",
    ]
      .map(csvCell)
      .join(","),
  );
  return lines.join("\n");
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}