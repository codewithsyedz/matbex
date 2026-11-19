/**
 * Regression suite: July 2026 sales, expenses and payroll must always be
 * filtered by the active branch.
 *
 * The the API mock here is filter-aware, so dropping a `branch_id` /
 * `assigned_branch_id` filter in production code changes the returned rows and
 * fails these tests instead of silently showing tenant-wide totals.
 */
import { describe, it, expect, vi } from "vitest";
import {
  RESTAURANT_ID,
  BRANCH_HQ,
  BRANCH_WADI,
  JULY_FROM,
  JULY_TO,
  julySalesTransactions,
  julyDailySalesSummary,
  julyDayEndAdjustments,
  julyExpenses,
  expectedSalesTotals,
  expectedExpenseTotals,
  julyStaff,
  julyPayrollRecords,
  expectedPayroll,
} from "@/test/fixtures/julyBranchFixtures";
import { createDbTableMock } from "@/test/utils/dbTableMock";
import { filterStaffActiveInPeriod, calculateMonthlyPayroll } from "@/lib/staffUtils";

vi.mock("@/integrations/db/client", async () => {
  const { createDbTableMock } = await import("@/test/utils/dbTableMock");
  const fixtures = await import("@/test/fixtures/julyBranchFixtures");
  const mock = createDbTableMock({
    sales_transactions: fixtures.julySalesTransactions,
    daily_sales_summary: fixtures.julyDailySalesSummary,
    day_end_adjustments: fixtures.julyDayEndAdjustments,
    expenses: fixtures.julyExpenses,
    staff: fixtures.julyStaff,
    payroll_records: fixtures.julyPayrollRecords,
    staff_advances: fixtures.julyStaffAdvances,
  });
  // sale_account_amounts: what customer sales put on the tab (set per test).
  (mock.db as any).rpc = async (name: string) => ({
    data: name === "sale_account_amounts" ? ((globalThis as any).__tabRows ?? []) : null,
    error: null,
  });
  return { db: mock.db };
});

const { fetchReconciledSalesByDay } = await import("@/lib/reconciledSales");
const { db } = await import("@/integrations/db/client");

// ---------------------------------------------------------------- Sales -----

describe("July sales are branch-filtered", () => {
  it("an open day's tab sales are not counted as cash or card", async () => {
    // t6: a 300 card-method sale at Al-Wadi on 07-05 that went entirely on a customer's tab.
    (globalThis as any).__tabRows = [{ sale_id: "t6", on_account: 300 }];
    try {
      const r = await fetchReconciledSalesByDay({
        restaurantId: RESTAURANT_ID, dateFrom: JULY_FROM, dateTo: JULY_TO, branchId: BRANCH_WADI,
      });
      expect(r.summaryDetailByDay.get("2026-07-05")).toMatchObject({ cash: 0, card: 0, other: 300 });
    } finally {
      (globalThis as any).__tabRows = [];
    }
  });

  const fetchFor = (branchId: string | null) =>
    fetchReconciledSalesByDay({
      restaurantId: RESTAURANT_ID,
      dateFrom: JULY_FROM,
      dateTo: JULY_TO,
      branchId,
    });

  it("HQ view only counts HQ POS rows and HQ-tagged adjustments", async () => {
    const r = await fetchFor(BRANCH_HQ);
    expect(r.total).toBe(expectedSalesTotals.hq);
    expect(r.txCount).toBe(4);
    // 07-02 is closed for HQ, so the branch's own summary total wins.
    expect(r.perDay.get("2026-07-02")).toBe(2000);
    expect(r.perDay.get("2026-07-03")).toBe(400);
    // Wadi / untagged / other-tenant days must be absent
    expect(r.perDay.get("2026-07-05")).toBeUndefined();
    expect(r.perDay.get("2026-07-06")).toBeUndefined();
  });

  it("Al-Wadi view only counts Wadi rows and ignores reversed adjustments", async () => {
    const r = await fetchFor(BRANCH_WADI);
    expect(r.total).toBe(expectedSalesTotals.wadi);
    // Wadi never sees HQ's closed-day override.
    expect(r.summaryByDay.size).toBe(0);
    expect(r.perDay.get("2026-07-05")).toBe(275);
    expect(r.adjustmentsByDay.get("2026-07-05")).toBe(-25);
  });

  it("branch views only apply their own branch's daily_sales_summary override", async () => {
    const r = await fetchFor(BRANCH_HQ);
    expect(r.summaryByDay.size).toBe(1);
    expect(r.summaryByDay.get("2026-07-02")).toBe(2000);
    expect(r.summaryDerivedFromBranchPos).toBe(true);
    // Derived breakdown must come from that branch's own payment methods.
    expect(r.summaryDetailByDay.get("2026-07-03")).toEqual({
      total: 400,
      cash: 0,
      card: 250,
      delivery: 100,
      other: 0,
    });
  });

  it("untagged scope isolates legacy rows with no branch", async () => {
    const r = await fetchFor("untagged");
    expect(r.total).toBe(expectedSalesTotals.untagged);
    expect(r.txCount).toBe(1);
  });

  it("All branches view aggregates everything and applies the summary override", async () => {
    const r = await fetchFor(null);
    expect(r.total).toBe(expectedSalesTotals.all);
    expect(r.summaryByDay.get("2026-07-02")).toBe(2000);
  });

  it("branch totals never exceed the All branches total", async () => {
    const [hq, wadi, untagged, all] = await Promise.all([
      fetchFor(BRANCH_HQ),
      fetchFor(BRANCH_WADI),
      fetchFor("untagged"),
      fetchFor(null),
    ]);
    for (const scoped of [hq, wadi, untagged]) {
      expect(scoped.total).toBeLessThan(all.total);
    }
    // Without the closed-day override the parts add up to the raw whole.
    const rawSum = [hq, wadi, untagged].reduce(
      (s, r) => s + Array.from(r.rawTxByDay.values()).reduce((a, b) => a + b, 0),
      0,
    );
    const allRaw = Array.from(all.rawTxByDay.values()).reduce((a, b) => a + b, 0);
    expect(rawSum).toBe(allRaw);
  });
});

// ------------------------------------------------------------- Expenses -----

async function fetchJulyExpenses(branchId: string | null) {
  let q: any = db
    .from("expenses")
    .select("id, amount, branch_id, expense_date")
    .eq("restaurant_id", RESTAURANT_ID)
    .is("deleted_at", null)
    .gte("expense_date", JULY_FROM)
    .lte("expense_date", JULY_TO);
  if (branchId === "untagged") q = q.is("branch_id", null);
  else if (branchId) q = q.eq("branch_id", branchId);
  const { data } = await q;
  return (data || []).reduce((s: number, r: any) => s + Number(r.amount || 0), 0);
}

describe("July expenses are branch-filtered", () => {
  it("scopes totals per branch and excludes soft-deleted rows", async () => {
    expect(await fetchJulyExpenses(BRANCH_HQ)).toBe(expectedExpenseTotals.hq);
    expect(await fetchJulyExpenses(BRANCH_WADI)).toBe(expectedExpenseTotals.wadi);
    expect(await fetchJulyExpenses("untagged")).toBe(expectedExpenseTotals.untagged);
  });

  it("All branches equals the sum of the branch scopes", async () => {
    const all = await fetchJulyExpenses(null);
    expect(all).toBe(expectedExpenseTotals.all);
    expect(all).toBe(
      (await fetchJulyExpenses(BRANCH_HQ)) +
        (await fetchJulyExpenses(BRANCH_WADI)) +
        (await fetchJulyExpenses("untagged")),
    );
  });

  it("excludes other tenants and out-of-range dates", async () => {
    const { data } = await (db
      .from("expenses")
      .select("id")
      .eq("restaurant_id", RESTAURANT_ID)
      .is("deleted_at", null)
      .gte("expense_date", JULY_FROM)
      .lte("expense_date", JULY_TO) as any);
    const ids = (data || []).map((r: any) => r.id);
    expect(ids).not.toContain("e7"); // June
    expect(ids).not.toContain("e8"); // other tenant
    expect(ids).not.toContain("e5"); // soft-deleted
  });
});

// --------------------------------------------------------------- Payroll ----

const JULY_START = new Date("2026-07-01T00:00:00Z");
const JULY_END = new Date("2026-07-31T00:00:00Z");

async function julyPayrollFor(branchId: string | null) {
  let q: any = db
    .from("staff")
    .select("id, monthly_salary, hourly_rate, joined_date, termination_date, is_active, assigned_branch_id")
    .eq("restaurant_id", RESTAURANT_ID);
  if (branchId === "untagged") q = q.is("assigned_branch_id", null);
  else if (branchId) q = q.eq("assigned_branch_id", branchId);
  const { data } = await q;
  const active = filterStaffActiveInPeriod(data || [], JULY_START, JULY_END);
  return { gross: calculateMonthlyPayroll(active), staff: active };
}

describe("July payroll is branch-filtered", () => {
  it("uses assigned_branch_id, not tenant-wide staff", async () => {
    expect((await julyPayrollFor(BRANCH_HQ)).gross).toBe(expectedPayroll.hq);
    expect((await julyPayrollFor(BRANCH_WADI)).gross).toBe(expectedPayroll.wadi);
  });

  it("excludes unassigned staff from branch views but keeps them in All branches", async () => {
    const hq = await julyPayrollFor(BRANCH_HQ);
    const wadi = await julyPayrollFor(BRANCH_WADI);
    expect([...hq.staff, ...wadi.staff].map((s: any) => s.id)).not.toContain("s5");
    expect((await julyPayrollFor("untagged")).gross).toBe(expectedPayroll.unassignedOnly);
    expect((await julyPayrollFor(null)).gross).toBe(expectedPayroll.all);
  });

  it("excludes staff who joined after July or were terminated before it", async () => {
    const ids = (await julyPayrollFor(null)).staff.map((s: any) => s.id);
    expect(ids).not.toContain("s6");
    expect(ids).not.toContain("s7");
  });

  it("scopes payroll records to the branch's own staff", async () => {
    const branchStaffIds = new Set((await julyPayrollFor(BRANCH_HQ)).staff.map((s: any) => s.id));
    const scoped = julyPayrollRecords.filter((p) => branchStaffIds.has(p.staff_id));
    expect(scoped.map((p) => p.staff_id)).toEqual(["s1"]);
    expect(scoped.reduce((s, p) => s + p.amount, 0)).toBe(5000);
  });

  it("branch payrolls plus unassigned equal the tenant total", async () => {
    const parts =
      (await julyPayrollFor(BRANCH_HQ)).gross +
      (await julyPayrollFor(BRANCH_WADI)).gross +
      (await julyPayrollFor("untagged")).gross;
    expect(parts).toBe((await julyPayrollFor(null)).gross);
  });
});
