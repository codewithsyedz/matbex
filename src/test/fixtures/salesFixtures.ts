/**
 * Reusable seeded mock dataset for validating "Today's Sales" calculations.
 *
 * All timestamps are anchored to a fixed reference instant so tests are
 * deterministic regardless of the machine clock. Default timezone is
 * Asia/Riyadh (UTC+3, no DST) which matches our canonical restaurant tz.
 *
 * Usage:
 *   import { REFERENCE_DATE, RIYADH_TZ, salesScenarios } from "@/test/fixtures/salesFixtures";
 *   const { rows, expectedTotal, expectedCount } = salesScenarios.mixedShiftsAndUnassigned;
 *   const result = computeTodaySalesTotal(rows, REFERENCE_DATE, RIYADH_TZ);
 */
import type { SalesRowForToday } from "@/lib/salesMetrics";

export const RIYADH_TZ = "Asia/Riyadh";
export const UTC_TZ = "UTC";

/** Reference: 2026-04-25 12:00 Riyadh (= 09:00 UTC). */
export const REFERENCE_DATE = new Date("2026-04-25T09:00:00Z");

/** Riyadh-local day bounds for REFERENCE_DATE (for documentation/assertions). */
export const RIYADH_DAY_START_UTC = "2026-04-24T21:00:00.000Z";
export const RIYADH_DAY_END_EXCLUSIVE_UTC = "2026-04-25T21:00:00.000Z";

export const SHIFT_MORNING = "shift-morning-001";
export const SHIFT_NIGHT = "shift-night-002";

/** Helper: build a row with sensible defaults. */
export function makeSale(
  total: number | string | null,
  createdAtISO: string,
  shiftId: string | null = null,
): SalesRowForToday {
  return { total, created_at: createdAtISO, shift_id: shiftId };
}

export interface SalesScenario {
  name: string;
  description: string;
  rows: SalesRowForToday[];
  /** Expected sum of `total` for rows inside the Riyadh-local day. */
  expectedTotal: number;
  /** Expected count of rows inside the Riyadh-local day. */
  expectedCount: number;
}

/**
 * Curated scenarios. Every "in-day" timestamp is between
 * 2026-04-24T21:00:00Z (inclusive) and 2026-04-25T21:00:00Z (exclusive).
 */
export const salesScenarios = {
  empty: {
    name: "empty",
    description: "No transactions at all.",
    rows: [],
    expectedTotal: 0,
    expectedCount: 0,
  },

  onlyUnassigned: {
    name: "onlyUnassigned",
    description: "All sales today are unassigned (no shift_id).",
    rows: [
      makeSale(40, "2026-04-25T05:00:00Z", null),
      makeSale(60, "2026-04-25T11:30:00Z", null),
      makeSale(25.5, "2026-04-25T18:45:00Z", null),
    ],
    expectedTotal: 125.5,
    expectedCount: 3,
  },

  onlyAssigned: {
    name: "onlyAssigned",
    description: "All sales today belong to shifts.",
    rows: [
      makeSale(100, "2026-04-25T06:00:00Z", SHIFT_MORNING),
      makeSale(200, "2026-04-25T07:30:00Z", SHIFT_MORNING),
      makeSale(150, "2026-04-25T17:00:00Z", SHIFT_NIGHT),
    ],
    expectedTotal: 450,
    expectedCount: 3,
  },

  mixedShiftsAndUnassigned: {
    name: "mixedShiftsAndUnassigned",
    description: "Mix of morning shift, night shift, and unassigned transactions.",
    rows: [
      makeSale(120, "2026-04-25T05:15:00Z", SHIFT_MORNING),
      makeSale(80, "2026-04-25T08:00:00Z", SHIFT_MORNING),
      makeSale(45.25, "2026-04-25T11:00:00Z", null), // unassigned
      makeSale(300, "2026-04-25T16:00:00Z", SHIFT_NIGHT),
      makeSale(15.75, "2026-04-25T20:30:00Z", null), // unassigned, late
    ],
    expectedTotal: 561,
    expectedCount: 5,
  },

  boundariesInclusiveExclusive: {
    name: "boundariesInclusiveExclusive",
    description:
      "Edge cases: previous-day midnight (in), next-day midnight (out), one second before/after.",
    rows: [
      // Exactly local midnight start -> INCLUDED
      makeSale(10, RIYADH_DAY_START_UTC, SHIFT_MORNING),
      // 1 second before start -> EXCLUDED
      makeSale(999, "2026-04-24T20:59:59Z", null),
      // 1 second before end -> INCLUDED
      makeSale(20, "2026-04-25T20:59:59Z", null),
      // Exactly next local midnight -> EXCLUDED (half-open)
      makeSale(999, RIYADH_DAY_END_EXCLUSIVE_UTC, SHIFT_NIGHT),
    ],
    expectedTotal: 30,
    expectedCount: 2,
  },

  noisyTotals: {
    name: "noisyTotals",
    description: "String numerics, nulls, and non-numeric strings - must not crash.",
    rows: [
      makeSale("12.50" as unknown as string, "2026-04-25T08:00:00Z", SHIFT_MORNING),
      makeSale(null, "2026-04-25T09:00:00Z", null),
      makeSale("not-a-number" as unknown as string, "2026-04-25T10:00:00Z", null),
      makeSale(7, "2026-04-25T11:00:00Z", SHIFT_MORNING),
    ],
    expectedTotal: 19.5,
    expectedCount: 4,
  },

  spanningPriorAndNextDay: {
    name: "spanningPriorAndNextDay",
    description: "Includes rows from yesterday and tomorrow that must be excluded.",
    rows: [
      makeSale(500, "2026-04-23T12:00:00Z", SHIFT_MORNING), // 2 days ago
      makeSale(500, "2026-04-24T20:00:00Z", null), // yesterday late
      makeSale(50, "2026-04-25T03:00:00Z", SHIFT_MORNING), // today
      makeSale(75, "2026-04-25T19:00:00Z", null), // today, unassigned
      makeSale(500, "2026-04-26T03:00:00Z", SHIFT_NIGHT), // tomorrow
    ],
    expectedTotal: 125,
    expectedCount: 2,
  },
} as const satisfies Record<string, SalesScenario>;

export type SalesScenarioName = keyof typeof salesScenarios;

/** Flat seed combining every scenario - useful for "kitchen sink" tests. */
export function buildSeededSalesDataset(): SalesRowForToday[] {
  return Object.values(salesScenarios).flatMap((s) => s.rows);
}