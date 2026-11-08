import { getFiscalMonthRange } from "@/hooks/useFiscalSettings";
import { subDays } from "date-fns";

export interface PayrollCutoffRules {
  /** Fiscal month start day (1-28). */
  monthStartDay: number;
  /** Day of the calendar month on/after which payroll for the completed cycle is released (1-28). */
  payrollCutoffDay: number;
  /** How many completed cycles back payroll targets. 0 = current running cycle, 1 = last completed. */
  payrollPeriodOffset: number;
}

export interface ResolvedPayrollPeriod {
  start: Date;
  end: Date;
  /** How many cycles back from the running cycle this period is. */
  cyclesBack: number;
  /** True when the cut-off day has not been reached yet, so we stepped one cycle further back. */
  cutoffPending: boolean;
  /** Date in the current calendar month when the cut-off is reached. */
  cutoffDate: Date;
}

export const DEFAULT_PAYROLL_CUTOFF_DAY = 1;
export const DEFAULT_PAYROLL_PERIOD_OFFSET = 1;

function stepBackCycles(cycleStart: Date, monthStartDay: number, cycles: number) {
  let range = getFiscalMonthRange(cycleStart, monthStartDay);
  for (let i = 0; i < cycles; i++) {
    range = getFiscalMonthRange(subDays(range.start, 1), monthStartDay);
  }
  return range;
}

/**
 * Resolve which fiscal cycle payroll should be generated for, using the
 * tenant's configurable cut-off rules.
 */
export function resolvePayrollPeriod(
  today: Date,
  rules: PayrollCutoffRules
): ResolvedPayrollPeriod {
  const monthStartDay = clampDay(rules.monthStartDay, 1);
  const cutoffDay = clampDay(rules.payrollCutoffDay, DEFAULT_PAYROLL_CUTOFF_DAY);
  const offset = Math.min(3, Math.max(0, Math.round(rules.payrollPeriodOffset ?? DEFAULT_PAYROLL_PERIOD_OFFSET)));

  const cutoffDate = new Date(today.getFullYear(), today.getMonth(), cutoffDay);
  const cutoffPending = offset > 0 && today.getDate() < cutoffDay;
  const cyclesBack = offset + (cutoffPending ? 1 : 0);

  const current = getFiscalMonthRange(today, monthStartDay);
  const { start, end } = stepBackCycles(current.start, monthStartDay, cyclesBack);

  return { start, end, cyclesBack, cutoffPending, cutoffDate };
}

function clampDay(value: number | undefined | null, fallback: number): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(28, Math.max(1, n));
}

export function describePayrollPeriod(period: ResolvedPayrollPeriod): string {
  if (period.cyclesBack === 0) return "current running cycle";
  if (period.cyclesBack === 1) return "last completed cycle";
  return `${period.cyclesBack} cycles back`;
}
