import { getRestaurantDayBoundsUTC } from "@/lib/timezone";

export interface SalesRowForToday {
  total: number | string | null;
  created_at: string; // ISO UTC
  shift_id?: string | null;
}

/**
 * Sum of all sales transactions whose `created_at` falls within the
 * restaurant's local calendar day for `referenceDate` in `timeZone`.
 *
 * IMPORTANT: includes transactions with no `shift_id` (unassigned).
 * Bounds are half-open: [start, endExclusive).
 */
export function computeTodaySalesTotal(
  rows: SalesRowForToday[],
  referenceDate: Date,
  timeZone: string
): { total: number; count: number; startISO: string; endExclusiveISO: string } {
  const { start, endExclusive } = getRestaurantDayBoundsUTC(referenceDate, timeZone);
  let total = 0;
  let count = 0;
  for (const r of rows) {
    const ts = new Date(r.created_at).getTime();
    if (ts >= start.getTime() && ts < endExclusive.getTime()) {
      total += Number(r.total) || 0;
      count += 1;
    }
  }
  return {
    total,
    count,
    startISO: start.toISOString(),
    endExclusiveISO: endExclusive.toISOString(),
  };
}