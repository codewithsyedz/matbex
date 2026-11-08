import { isAcquisitionDerived } from "@/lib/projectReconciliation";

export type BudgetShiftFilter = "all" | "morning" | "night";

export interface BudgetPeriodFilter {
  /** Inclusive ISO date (yyyy-mm-dd). */
  from?: string | null;
  /** Inclusive ISO date (yyyy-mm-dd). */
  to?: string | null;
  shift?: BudgetShiftFilter;
}

export interface CategoryBreakdownRow {
  category: string;
  budget: number;
  committed: number;
  actual: number;
  paid: number;
  pending: number;
  pendingCount: number;
  recorded: number;
  outstanding: number;
  variance: number;
  lineId: string | null;
}

/** Riyadh hour of a timestamp, used to place a row in the 11–11 shift window. */
function riyadhHour(ts: string | null | undefined): number | null {
  if (!ts) return null;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  const h = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Riyadh",
    hour: "2-digit",
    hour12: false,
  }).format(d);
  return Number(h);
}

/** Morning shift = 11:00–22:59 Riyadh, night shift = 23:00–10:59. */
export function shiftOf(ts: string | null | undefined): "morning" | "night" | null {
  const h = riyadhHour(ts);
  if (h === null) return null;
  return h >= 11 && h < 23 ? "morning" : "night";
}

export function matchesPeriod(
  txn: { txn_date?: string | null; created_at?: string | null },
  filter?: BudgetPeriodFilter,
): boolean {
  if (!filter) return true;
  const date = txn.txn_date ?? null;
  if (filter.from && (!date || date < filter.from)) return false;
  if (filter.to && (!date || date > filter.to)) return false;
  if (filter.shift && filter.shift !== "all") {
    const s = shiftOf(txn.created_at);
    // Rows without a timestamp stay visible only when no shift filter is set.
    if (s !== filter.shift) return false;
  }
  return true;
}

export function buildCategoryBreakdown(
  txns: any[],
  lines: any[],
  commitments: any[],
  filter?: BudgetPeriodFilter,
): CategoryBreakdownRow[] {
  const recordedTxns = txns.filter((t) => !isAcquisitionDerived(t) && matchesPeriod(t, filter));
  const postedTxns = recordedTxns.filter((t) => t.status === "posted");
  const keys = new Set<string>([
    ...lines.map((l) => l.category),
    ...recordedTxns.map((t) => t.category ?? "Uncategorised"),
    ...commitments.map((c) => c.category),
  ]);
  const orderOf = (c: string) => {
    const line = lines.find((l) => l.category === c);
    return line ? Number(line.sort_order ?? 0) : Number.MAX_SAFE_INTEGER;
  };
  return Array.from(keys)
    .sort((a, b) => orderOf(a) - orderOf(b) || a.localeCompare(b))
    .map((category) => {
      const budget = lines
        .filter((l) => l.category === category)
        .reduce((s, l) => s + Number(l.budget_amount), 0);
      const rows = postedTxns.filter((t) => (t.category ?? "Uncategorised") === category);
      const actual = rows.reduce((s, t) => s + Number(t.amount), 0);
      const paid = rows.filter((t) => t.is_paid).reduce((s, t) => s + Number(t.amount), 0);
      const pendingRows = recordedTxns.filter(
        (t) => (t.category ?? "Uncategorised") === category && t.status !== "posted",
      );
      const pending = pendingRows.reduce((s, t) => s + Number(t.amount), 0);
      const recorded = actual + pending;
      const committed = commitments
        .filter((c) => c.category === category && c.status !== "cancelled")
        .reduce((s, c) => s + Number(c.contract_amount), 0);
      return {
        category,
        budget,
        committed,
        actual,
        paid,
        pending,
        pendingCount: pendingRows.length,
        recorded,
        outstanding: actual - paid,
        variance: budget - recorded,
        lineId: lines.find((l) => l.category === category)?.id ?? null,
      };
    });
}
