import { describe, it, expect } from "vitest";
import { computeTodaySalesTotal } from "@/lib/salesMetrics";
import {
  REFERENCE_DATE,
  RIYADH_TZ,
  RIYADH_DAY_START_UTC,
  RIYADH_DAY_END_EXCLUSIVE_UTC,
  buildSeededSalesDataset,
  salesScenarios,
} from "@/test/fixtures/salesFixtures";

describe("Today's Sales - seeded scenarios (Asia/Riyadh)", () => {
  for (const scenario of Object.values(salesScenarios)) {
    it(`scenario "${scenario.name}": ${scenario.description}`, () => {
      const result = computeTodaySalesTotal(scenario.rows, REFERENCE_DATE, RIYADH_TZ);
      expect(result.total).toBeCloseTo(scenario.expectedTotal, 2);
      expect(result.count).toBe(scenario.expectedCount);
      expect(result.startISO).toBe(RIYADH_DAY_START_UTC);
      expect(result.endExclusiveISO).toBe(RIYADH_DAY_END_EXCLUSIVE_UTC);
    });
  }

  it("kitchen sink: combined dataset equals sum of per-scenario expectations", () => {
    const all = buildSeededSalesDataset();
    const expectedTotal = Object.values(salesScenarios).reduce(
      (s, x) => s + x.expectedTotal,
      0,
    );
    const expectedCount = Object.values(salesScenarios).reduce(
      (s, x) => s + x.expectedCount,
      0,
    );
    const result = computeTodaySalesTotal(all, REFERENCE_DATE, RIYADH_TZ);
    expect(result.total).toBeCloseTo(expectedTotal, 2);
    expect(result.count).toBe(expectedCount);
  });

  it("unassigned transactions are NEVER dropped from today's total", () => {
    const { rows } = salesScenarios.mixedShiftsAndUnassigned;
    const unassignedTotal = rows
      .filter((r) => !r.shift_id)
      .reduce((s, r) => s + (Number(r.total) || 0), 0);
    const result = computeTodaySalesTotal(rows, REFERENCE_DATE, RIYADH_TZ);
    // result.total must be at least the unassigned slice
    expect(result.total).toBeGreaterThanOrEqual(unassignedTotal);
    expect(unassignedTotal).toBeGreaterThan(0);
  });
});