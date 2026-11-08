/**
 * Splits a fine that exceeds the legally allowed monthly deduction into
 * consecutive payroll-month installments, so the full amount is recovered
 * over the next salaries instead of being blocked at creation time.
 */
export interface FineInstallment {
  installment_number: number;
  payroll_month: string; // yyyy-MM-01
  amount: number;
}

export interface InstallmentScheduleInput {
  /** Full fine amount decided by management. */
  totalAmount: number;
  /** First payroll month (yyyy-MM-dd or yyyy-MM). */
  startMonth: string;
  /** Capacity still available in the first payroll month. */
  firstMonthCapacity: number;
  /** Recurring monthly fine limit for the employee. */
  monthlyLimit: number;
  /** Optional hard cap per single fine record (0 = not configured). */
  maxPerViolation?: number;
  /** Safety bound so a misconfiguration cannot generate endless rows. */
  maxMonths?: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function addMonths(month: string, offset: number): string {
  const [y, m] = month.slice(0, 7).split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + offset, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export function buildFineInstallmentSchedule({
  totalAmount,
  startMonth,
  firstMonthCapacity,
  monthlyLimit,
  maxPerViolation = 0,
  maxMonths = 24,
}: InstallmentScheduleInput): FineInstallment[] {
  const total = round2(Number(totalAmount) || 0);
  if (total <= 0) return [];

  const cap = (v: number) => (maxPerViolation > 0 ? Math.min(v, maxPerViolation) : v);
  const recurring = round2(cap(Number(monthlyLimit) || 0));
  const first = round2(Math.max(0, cap(Number(firstMonthCapacity) || 0)));

  // No configured limit — a single installment covers everything.
  if (recurring <= 0 && first <= 0) {
    return [{ installment_number: 1, payroll_month: addMonths(startMonth, 0), amount: total }];
  }

  const schedule: FineInstallment[] = [];
  let remaining = total;
  let index = 0;

  while (remaining > 0.004 && schedule.length < maxMonths) {
    const capacity = index === 0 ? first : recurring;
    if (capacity <= 0) {
      index += 1;
      continue;
    }
    const amount = round2(Math.min(capacity, remaining));
    schedule.push({
      installment_number: schedule.length + 1,
      payroll_month: addMonths(startMonth, index),
      amount,
    });
    remaining = round2(remaining - amount);
    index += 1;
  }

  // Anything left after the safety bound is folded into the last installment.
  if (remaining > 0.004 && schedule.length) {
    const last = schedule[schedule.length - 1];
    last.amount = round2(last.amount + remaining);
  }

  return schedule;
}

export function summarizeSchedule(schedule: FineInstallment[]) {
  return {
    months: schedule.length,
    total: round2(schedule.reduce((s, i) => s + i.amount, 0)),
    firstAmount: schedule[0]?.amount ?? 0,
    lastMonth: schedule[schedule.length - 1]?.payroll_month ?? null,
  };
}
