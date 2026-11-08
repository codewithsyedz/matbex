import { addMonths, differenceInCalendarDays, format, parseISO, startOfDay } from "date-fns";
import { getFiscalMonthRange } from "@/hooks/useFiscalSettings";

/** Payroll is always computed on a fixed 30-day month basis. */
export const PAYROLL_MONTH_DAYS = 30;

export interface SalaryCalendarStaff {
  id: string;
  name: string;
  role: string;
  payment_type: string;
  monthly_salary: number | null;
  assigned_branch_id?: string | null;
  joined_date?: string | null;
  termination_date?: string | null;
}

export interface SalaryCycle {
  /** yyyy-MM key of the cycle end month. */
  key: string;
  label: string;
  start: Date;
  end: Date;
  /** Date the cycle's salary becomes payable. */
  paymentDate: Date;
}

export interface SalaryCell {
  staffId: string;
  cycleKey: string;
  /** Full monthly salary before proration. */
  fullSalary: number;
  /** Days of the cycle the employee is actually employed (capped at 30). */
  payableDays: number;
  /** Prorated amount payable for the cycle. */
  amount: number;
  isProrated: boolean;
  reason?: "joining" | "leaving" | "not-employed";
  isPaid: boolean;
}

export interface SalaryCalendarRow {
  staff: SalaryCalendarStaff;
  cells: SalaryCell[];
  total: number;
}

function toDate(value?: string | null): Date | null {
  if (!value) return null;
  const d = typeof value === "string" ? parseISO(value) : value;
  return Number.isNaN(d.getTime()) ? null : startOfDay(d);
}

/**
 * Build a forward-looking list of fiscal payroll cycles starting from the
 * cycle that contains `anchor`.
 */
export function buildSalaryCycles(
  anchor: Date,
  monthStartDay: number,
  months: number,
  payrollCutoffDay: number
): SalaryCycle[] {
  const cycles: SalaryCycle[] = [];
  let range = getFiscalMonthRange(anchor, monthStartDay);
  for (let i = 0; i < months; i++) {
    const end = range.end;
    const payMonth = addMonths(new Date(end.getFullYear(), end.getMonth(), 1), 1);
    const paymentDate = new Date(
      payMonth.getFullYear(),
      payMonth.getMonth(),
      Math.min(28, Math.max(1, Math.round(payrollCutoffDay) || 1))
    );
    cycles.push({
      key: format(end, "yyyy-MM"),
      label: format(end, "MMM yyyy"),
      start: range.start,
      end,
      paymentDate,
    });
    range = getFiscalMonthRange(new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1), monthStartDay);
  }
  return cycles;
}

/** Prorated salary for one employee in one cycle, on a fixed 30-day basis. */
export function computeSalaryCell(
  staff: SalaryCalendarStaff,
  cycle: SalaryCycle,
  paidCycleKeys: Set<string>
): SalaryCell {
  const fullSalary = Number(staff.monthly_salary ?? 0);
  const joined = toDate(staff.joined_date);
  const left = toDate(staff.termination_date);

  const effectiveStart = joined && joined > cycle.start ? joined : cycle.start;
  const effectiveEnd = left && left < cycle.end ? left : cycle.end;

  const base = {
    staffId: staff.id,
    cycleKey: cycle.key,
    fullSalary,
    isPaid: paidCycleKeys.has(cycle.key),
  };

  if (effectiveEnd < effectiveStart) {
    return { ...base, payableDays: 0, amount: 0, isProrated: false, reason: "not-employed" };
  }

  const rawDays = differenceInCalendarDays(effectiveEnd, effectiveStart) + 1;
  const payableDays = Math.min(PAYROLL_MONTH_DAYS, Math.max(0, rawDays));
  const isFull = payableDays >= PAYROLL_MONTH_DAYS;
  const amount = isFull
    ? fullSalary
    : Math.round(((fullSalary * payableDays) / PAYROLL_MONTH_DAYS) * 100) / 100;

  return {
    ...base,
    payableDays,
    amount,
    isProrated: !isFull,
    reason: isFull ? undefined : joined && joined > cycle.start ? "joining" : left && left < cycle.end ? "leaving" : undefined,
  };
}

export function buildSalaryCalendar(
  staffList: SalaryCalendarStaff[],
  cycles: SalaryCycle[],
  paidByStaff: Record<string, Set<string>>
): SalaryCalendarRow[] {
  return staffList.map((staff) => {
    const paid = paidByStaff[staff.id] ?? new Set<string>();
    const cells = cycles.map((cycle) => computeSalaryCell(staff, cycle, paid));
    return {
      staff,
      cells,
      total: Math.round(cells.reduce((sum, c) => sum + c.amount, 0) * 100) / 100,
    };
  });
}

export interface SalaryBranchGroup {
  branchId: string;
  branchName: string;
  rows: SalaryCalendarRow[];
  /** Per-cycle totals for this branch, aligned with the cycles array. */
  cycleTotals: number[];
  total: number;
}

/** Group calendar rows by their assigned branch, with per-branch cycle subtotals. */
export function groupSalaryCalendarByBranch(
  rows: SalaryCalendarRow[],
  cycles: SalaryCycle[],
  branchNames: Record<string, string>
): SalaryBranchGroup[] {
  const buckets = new Map<string, SalaryCalendarRow[]>();
  for (const row of rows) {
    const key = row.staff.assigned_branch_id ?? "unassigned";
    const list = buckets.get(key);
    if (list) list.push(row);
    else buckets.set(key, [row]);
  }

  const groups: SalaryBranchGroup[] = [];
  for (const [branchId, groupRows] of buckets) {
    const cycleTotals = cycles.map((_, i) =>
      Math.round(groupRows.reduce((sum, r) => sum + (r.cells[i]?.amount ?? 0), 0) * 100) / 100
    );
    groups.push({
      branchId,
      branchName:
        branchId === "unassigned" ? "Unassigned" : branchNames[branchId] ?? "Unknown branch",
      rows: groupRows,
      cycleTotals,
      total: Math.round(cycleTotals.reduce((a, b) => a + b, 0) * 100) / 100,
    });
  }

  return groups.sort((a, b) => {
    if (a.branchId === "unassigned") return 1;
    if (b.branchId === "unassigned") return -1;
    return a.branchName.localeCompare(b.branchName);
  });
}

export function buildSalaryCalendarCsv(rows: SalaryCalendarRow[], cycles: SalaryCycle[]): string {
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const header = [
    "Employee",
    "Role",
    ...cycles.map((c) => `${c.label} (pay ${format(c.paymentDate, "dd MMM yyyy")})`),
    "Total",
  ];
  const lines = [header.map(esc).join(",")];
  for (const row of rows) {
    lines.push(
      [
        esc(row.staff.name),
        esc(row.staff.role),
        ...row.cells.map((c) => esc(c.amount.toFixed(2))),
        esc(row.total.toFixed(2)),
      ].join(",")
    );
  }
  const totals = cycles.map((_, i) =>
    rows.reduce((sum, r) => sum + (r.cells[i]?.amount ?? 0), 0)
  );
  lines.push(
    [
      esc("TOTAL"),
      esc(""),
      ...totals.map((t) => esc(t.toFixed(2))),
      esc(totals.reduce((a, b) => a + b, 0).toFixed(2)),
    ].join(",")
  );
  return lines.join("\n");
}

/** CSV with a Branch column, per-branch subtotal rows and a grand total. */
export function buildBranchSalaryCalendarCsv(
  groups: SalaryBranchGroup[],
  cycles: SalaryCycle[]
): string {
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const header = [
    "Branch",
    "Employee",
    "Role",
    ...cycles.map((c) => `${c.label} (pay ${format(c.paymentDate, "dd MMM yyyy")})`),
    "Total",
  ];
  const lines = [header.map(esc).join(",")];

  for (const group of groups) {
    for (const row of group.rows) {
      lines.push(
        [
          esc(group.branchName),
          esc(row.staff.name),
          esc(row.staff.role),
          ...row.cells.map((c) => esc(c.amount.toFixed(2))),
          esc(row.total.toFixed(2)),
        ].join(",")
      );
    }
    lines.push(
      [
        esc(group.branchName),
        esc(`${group.branchName} subtotal`),
        esc(""),
        ...group.cycleTotals.map((t) => esc(t.toFixed(2))),
        esc(group.total.toFixed(2)),
      ].join(",")
    );
  }

  const grandCycles = cycles.map((_, i) =>
    groups.reduce((sum, g) => sum + (g.cycleTotals[i] ?? 0), 0)
  );
  lines.push(
    [
      esc("ALL"),
      esc("TOTAL"),
      esc(""),
      ...grandCycles.map((t) => esc(t.toFixed(2))),
      esc(grandCycles.reduce((a, b) => a + b, 0).toFixed(2)),
    ].join(",")
  );
  return lines.join("\n");
}

