/** Starter plan helpers. Starter tenants get a reduced set of screens. */
export const STARTER_PLAN_NAME = "starter";

export function isStarterPlan(plan: { name?: string | null } | null | undefined): boolean {
  return (plan?.name ?? "").toLowerCase() === STARTER_PLAN_NAME;
}

/** Protected tenant screens a Starter account can open; never applied to public/auth routes. */
export const STARTER_ALLOWED_PATHS = [
  "/dashboard",
  "/record-sale",
  "/daily-report",
  "/shifts",
  "/sales",
  "/menu",
  "/settings",
  "/billing",
  "/onboarding",
  "/profile",
];

export function isStarterAllowedPath(pathname: string): boolean {
  // Provider application preparation does not enable ZATCA invoicing features.
  if (pathname === "/accounting/zatca-provider") return true;
  if (pathname.startsWith("/sales/")) return false;
  return STARTER_ALLOWED_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export interface DayRow {
  date: string;
  cash: number;
  card: number;
  other: number;
  total: number;
  expenses: number;
  status: string | null;
}

/** Combine day-end summaries and expenses into one row per day (newest first). */
export function buildDailyRows(
  sales: { sales_date: string; cash_sales: number | null; card_sales: number | null; delivery_sales: number | null; other_sales: number | null; status: string | null }[],
  expenses: { expense_date: string; amount: number | null }[],
): DayRow[] {
  const map = new Map<string, DayRow>();
  const get = (d: string) => {
    let r = map.get(d);
    if (!r) {
      r = { date: d, cash: 0, card: 0, other: 0, total: 0, expenses: 0, status: null };
      map.set(d, r);
    }
    return r;
  };
  for (const s of sales) {
    const r = get(s.sales_date);
    r.cash += Number(s.cash_sales ?? 0);
    r.card += Number(s.card_sales ?? 0);
    r.other += Number(s.delivery_sales ?? 0) + Number(s.other_sales ?? 0);
    r.status = s.status;
  }
  for (const e of expenses) get(e.expense_date.slice(0, 10)).expenses += Number(e.amount ?? 0);
  for (const r of map.values()) r.total = r.cash + r.card + r.other;
  return [...map.values()].sort((a, b) => b.date.localeCompare(a.date));
}
