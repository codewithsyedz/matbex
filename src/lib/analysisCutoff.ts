import { differenceInCalendarDays, endOfDay, subDays } from "date-fns";

/**
 * Single source of truth for the analysis cutoff used by monthly and
 * forecasting dashboard cards.
 *
 * Rule: analysis reads only COMPLETE days. Today is still in progress (sales
 * are still coming in, day-end adjustments are not applied, expenses/payroll
 * may be unrecorded), so the cutoff is YESTERDAY for the current period.
 * Closed/past periods use the period end as-is.
 */
export interface AnalysisWindow {
  /** Last day included in the data window (inclusive). */
  cutoffDate: Date;
  /** Inclusive days from periodStart → cutoffDate. Denominator for averages. */
  elapsedDays: number;
  /** Days left between cutoffDate and periodEnd. Multiplier for projections. */
  remainingDays: number;
  /** Total inclusive days in the period. */
  totalDays: number;
  /** True when the period is closed (cutoff = periodEnd, no projection). */
  isClosedPeriod: boolean;
}

export interface AnalysisWindowOptions {
  /** Effective period start (already clamped to the restaurant start date). */
  periodStart: Date;
  /** Period end (fiscal month end). */
  periodEnd: Date;
  /** True for a completed period (e.g. "last month") — no yesterday cutoff. */
  isClosedPeriod?: boolean;
  /** Reference "now". Defaults to the current moment. Injectable for tests. */
  now?: Date;
}

/** Yesterday, end of day — the last complete day relative to `now`. */
export function getAnalysisCutoffDate(now: Date = new Date()): Date {
  return endOfDay(subDays(now, 1));
}

export function getAnalysisWindow({
  periodStart,
  periodEnd,
  isClosedPeriod = false,
  now = new Date(),
}: AnalysisWindowOptions): AnalysisWindow {
  const totalDays = Math.max(1, differenceInCalendarDays(periodEnd, periodStart) + 1);

  let cutoffDate: Date;
  if (isClosedPeriod) {
    cutoffDate = periodEnd;
  } else {
    const yesterday = getAnalysisCutoffDate(now);
    // Clamp inside the period so the window is never negative or in the future.
    cutoffDate = yesterday < periodStart ? periodStart : yesterday > periodEnd ? periodEnd : yesterday;
  }

  const elapsedDays = Math.max(1, differenceInCalendarDays(cutoffDate, periodStart) + 1);
  const remainingDays = isClosedPeriod
    ? 0
    : Math.max(0, differenceInCalendarDays(periodEnd, cutoffDate));

  return { cutoffDate, elapsedDays, remainingDays, totalDays, isClosedPeriod };
}
