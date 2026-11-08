/**
 * Deterministic July-2026 seed data for branch-scoping regression tests.
 *
 * Covers three scopes:
 *   - HQ branch          (`BRANCH_HQ`)
 *   - Al-Wadi branch     (`BRANCH_WADI`)
 *   - Untagged rows      (`branch_id = null`) — must never leak into a branch view
 *
 * Every expected total below is hand-computed from the rows in this file, so a
 * regression that drops a `branch_id` filter (branch view showing tenant-wide
 * totals) makes the assertions fail immediately.
 */
export const RESTAURANT_ID = "rest-0001";
export const BRANCH_HQ = "branch-hq";
export const BRANCH_WADI = "branch-wadi";

export const JULY_FROM = "2026-07-01";
export const JULY_TO = "2026-07-31";

/** ---------------- Sales (POS transactions) ---------------- */
export const julySalesTransactions = [
  // HQ: 1000 + 500 cash, 250 card, 100 delivery = 1850
  { id: "t1", restaurant_id: RESTAURANT_ID, branch_id: BRANCH_HQ, total: 1000, payment_method: "cash", is_delivery: false, created_at: "2026-07-02T09:00:00Z" },
  { id: "t2", restaurant_id: RESTAURANT_ID, branch_id: BRANCH_HQ, total: 500, payment_method: "cash", is_delivery: false, created_at: "2026-07-02T15:00:00Z" },
  { id: "t3", restaurant_id: RESTAURANT_ID, branch_id: BRANCH_HQ, total: 250, payment_method: "card", is_delivery: false, created_at: "2026-07-03T10:00:00Z" },
  { id: "t4", restaurant_id: RESTAURANT_ID, branch_id: BRANCH_HQ, total: 100, payment_method: "card", is_delivery: true, created_at: "2026-07-03T18:00:00Z" },
  // Al-Wadi: 400 cash + 300 card = 700
  { id: "t5", restaurant_id: RESTAURANT_ID, branch_id: BRANCH_WADI, total: 400, payment_method: "cash", is_delivery: false, created_at: "2026-07-02T11:00:00Z" },
  { id: "t6", restaurant_id: RESTAURANT_ID, branch_id: BRANCH_WADI, total: 300, payment_method: "card", is_delivery: false, created_at: "2026-07-05T13:00:00Z" },
  // Untagged legacy row: 150
  { id: "t7", restaurant_id: RESTAURANT_ID, branch_id: null, total: 150, payment_method: "cash", is_delivery: false, created_at: "2026-07-06T12:00:00Z" },
  // Different restaurant — must never appear
  { id: "t8", restaurant_id: "rest-other", branch_id: BRANCH_HQ, total: 9999, payment_method: "cash", is_delivery: false, created_at: "2026-07-06T12:00:00Z" },
  // June row (outside range)
  { id: "t9", restaurant_id: RESTAURANT_ID, branch_id: BRANCH_HQ, total: 8888, payment_method: "cash", is_delivery: false, created_at: "2026-06-30T12:00:00Z" },
];

/** Branch-scoped closed-day summaries (one row per restaurant + branch + date). */
export const julyDailySalesSummary = [
  {
    restaurant_id: RESTAURANT_ID,
    branch_id: BRANCH_HQ,
    sales_date: "2026-07-02",
    total_sales: 2000, // operator-adjusted HQ total for 2026-07-02
    cash_sales: 1900,
    card_sales: 100,
    delivery_sales: 0,
    other_sales: 0,
  },
];

/** Branch-tagged day-end adjustments (scope = daily_sales). */
export const julyDayEndAdjustments = [
  { restaurant_id: RESTAURANT_ID, branch_id: BRANCH_HQ, scope: "daily_sales", amount: 50, business_date: "2026-07-03", reversed_at: null, reversal_of_id: null },
  { restaurant_id: RESTAURANT_ID, branch_id: BRANCH_WADI, scope: "daily_sales", amount: -25, business_date: "2026-07-05", reversed_at: null, reversal_of_id: null },
  // reversed original — ignored
  { restaurant_id: RESTAURANT_ID, branch_id: BRANCH_WADI, scope: "daily_sales", amount: 500, business_date: "2026-07-05", reversed_at: "2026-07-05T20:00:00Z", reversal_of_id: null },
  // untagged adjustment — only visible in "All branches"
  { restaurant_id: RESTAURANT_ID, branch_id: null, scope: "daily_sales", amount: 10, business_date: "2026-07-06", reversed_at: null, reversal_of_id: null },
];

export const expectedSalesTotals = {
  /** HQ: 07-02 closed at 2000 (overrides 1500 POS) + 07-03 (350 + 50). */
  hq: 2400,
  /** Wadi POS 700 - 25 adjustment. */
  wadi: 675,
  /** Untagged POS 150 + 10 adjustment. */
  untagged: 160,
  /**
   * All branches: 2026-07-02 overridden by the summary (2000, replaces 1400 POS),
   * plus 2026-07-03 (350 + 50), 2026-07-05 (300 - 25), 2026-07-06 (150 + 10).
   */
  all: 2000 + 400 + 275 + 160,
};

/** ---------------- Expenses ---------------- */
export const julyExpenses = [
  { id: "e1", restaurant_id: RESTAURANT_ID, branch_id: BRANCH_HQ, amount: 300, expense_date: "2026-07-04", deleted_at: null },
  { id: "e2", restaurant_id: RESTAURANT_ID, branch_id: BRANCH_HQ, amount: 200, expense_date: "2026-07-10", deleted_at: null },
  { id: "e3", restaurant_id: RESTAURANT_ID, branch_id: BRANCH_WADI, amount: 120, expense_date: "2026-07-04", deleted_at: null },
  { id: "e4", restaurant_id: RESTAURANT_ID, branch_id: BRANCH_WADI, amount: 80, expense_date: "2026-07-20", deleted_at: null },
  // soft-deleted — excluded everywhere
  { id: "e5", restaurant_id: RESTAURANT_ID, branch_id: BRANCH_WADI, amount: 5000, expense_date: "2026-07-21", deleted_at: "2026-07-22T00:00:00Z" },
  { id: "e6", restaurant_id: RESTAURANT_ID, branch_id: null, amount: 60, expense_date: "2026-07-11", deleted_at: null },
  // June + other tenant — excluded
  { id: "e7", restaurant_id: RESTAURANT_ID, branch_id: BRANCH_HQ, amount: 777, expense_date: "2026-06-30", deleted_at: null },
  { id: "e8", restaurant_id: "rest-other", branch_id: BRANCH_HQ, amount: 999, expense_date: "2026-07-05", deleted_at: null },
];

export const expectedExpenseTotals = {
  hq: 500,
  wadi: 200,
  untagged: 60,
  all: 760,
};

/** ---------------- Staff / payroll ---------------- */
export const julyStaff = [
  { id: "s1", restaurant_id: RESTAURANT_ID, assigned_branch_id: BRANCH_HQ, monthly_salary: 5000, hourly_rate: null, joined_date: "2025-01-01", termination_date: null, is_active: true },
  { id: "s2", restaurant_id: RESTAURANT_ID, assigned_branch_id: BRANCH_HQ, monthly_salary: 3000, hourly_rate: null, joined_date: "2025-06-01", termination_date: null, is_active: true },
  { id: "s3", restaurant_id: RESTAURANT_ID, assigned_branch_id: BRANCH_WADI, monthly_salary: 4000, hourly_rate: null, joined_date: "2026-01-01", termination_date: null, is_active: true },
  // hourly Wadi staff: 20 * 160 = 3200
  { id: "s4", restaurant_id: RESTAURANT_ID, assigned_branch_id: BRANCH_WADI, monthly_salary: null, hourly_rate: 20, joined_date: "2026-02-01", termination_date: null, is_active: true },
  // unassigned staff — only counted in "All branches"
  { id: "s5", restaurant_id: RESTAURANT_ID, assigned_branch_id: null, monthly_salary: 2500, hourly_rate: null, joined_date: "2025-03-01", termination_date: null, is_active: true },
  // joined after July — excluded from July payroll
  { id: "s6", restaurant_id: RESTAURANT_ID, assigned_branch_id: BRANCH_HQ, monthly_salary: 9000, hourly_rate: null, joined_date: "2026-08-15", termination_date: null, is_active: true },
  // terminated before July — excluded from July payroll
  { id: "s7", restaurant_id: RESTAURANT_ID, assigned_branch_id: BRANCH_WADI, monthly_salary: 7000, hourly_rate: null, joined_date: "2024-01-01", termination_date: "2026-05-31", is_active: false },
];

export const julyPayrollRecords = [
  { id: "p1", restaurant_id: RESTAURANT_ID, staff_id: "s1", amount: 5000, payment_date: "2026-07-31" },
  { id: "p2", restaurant_id: RESTAURANT_ID, staff_id: "s5", amount: 2500, payment_date: "2026-07-31" },
];

export const julyStaffAdvances = [
  { id: "a1", restaurant_id: RESTAURANT_ID, staff_id: "s3", amount: 500, status: "pending" },
  { id: "a2", restaurant_id: RESTAURANT_ID, staff_id: "s5", amount: 300, status: "pending" },
];

export const expectedPayroll = {
  hq: 8000, // s1 + s2
  wadi: 7200, // s3 (4000) + s4 hourly (3200)
  unassignedOnly: 2500, // s5
  all: 17700,
};
