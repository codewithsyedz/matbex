import { describe, it, expect } from "vitest";
import { computeTodaySalesTotal, type SalesRowForToday } from "@/lib/salesMetrics";

const TZ = "Asia/Riyadh"; // UTC+3, no DST

describe("computeTodaySalesTotal", () => {
  // Reference: 2026-04-25 12:00 Riyadh (= 09:00 UTC)
  const reference = new Date("2026-04-25T09:00:00Z");

  const rows: SalesRowForToday[] = [
    // Inside today (Riyadh): 2026-04-25 10:30 local = 07:30 UTC, has shift
    { total: 100, created_at: "2026-04-25T07:30:00Z", shift_id: "shift-a" },
    // Inside today (Riyadh): 2026-04-25 14:00 local = 11:00 UTC, NO shift
    { total: 50.5, created_at: "2026-04-25T11:00:00Z", shift_id: null },
    // Inside today (Riyadh): 2026-04-25 23:59 local = 20:59 UTC, NO shift
    { total: 25, created_at: "2026-04-25T20:59:00Z", shift_id: null },
    // BEFORE today: 2026-04-24 23:00 local = 20:00 UTC (yesterday in Riyadh)
    { total: 999, created_at: "2026-04-24T20:00:00Z", shift_id: "shift-b" },
    // AFTER today: 2026-04-26 00:00 local = 21:00 UTC (next day in Riyadh - exclusive)
    { total: 999, created_at: "2026-04-25T21:00:00Z", shift_id: null },
    // string-typed total (Supabase numeric arrives as string sometimes)
    { total: "12.50" as unknown as string, created_at: "2026-04-25T08:00:00Z" },
  ];

  it("includes unassigned (shift_id null) transactions in today's total", () => {
    const { total, count } = computeTodaySalesTotal(rows, reference, TZ);
    // 100 + 50.5 + 25 + 12.5 = 188.0, count = 4
    expect(total).toBeCloseTo(188.0, 2);
    expect(count).toBe(4);
  });

  it("excludes transactions outside the restaurant-local day", () => {
    const { count } = computeTodaySalesTotal(rows, reference, TZ);
    expect(count).toBe(4); // 2 of the 6 rows are outside
  });

  it("treats endExclusive as a half-open bound (next local midnight is excluded)", () => {
    const result = computeTodaySalesTotal(rows, reference, TZ);
    // 21:00 UTC = next local midnight in Riyadh -> excluded
    expect(result.endExclusiveISO).toBe("2026-04-25T21:00:00.000Z");
    expect(result.startISO).toBe("2026-04-24T21:00:00.000Z");
  });

  it("respects a different timezone for the same UTC rows", () => {
    // In UTC, the day starts/ends at 00:00 UTC, so the row at 2026-04-24T20:00:00Z
    // belongs to the PREVIOUS UTC day; the row at 2026-04-25T21:00:00Z belongs to TODAY.
    const result = computeTodaySalesTotal(rows, reference, "UTC");
    expect(result.startISO).toBe("2026-04-25T00:00:00.000Z");
    expect(result.endExclusiveISO).toBe("2026-04-26T00:00:00.000Z");
    // Inside UTC day 2026-04-25: 07:30, 11:00, 20:59, 21:00, 08:00 = 5 rows
    // Totals: 100 + 50.5 + 25 + 999 + 12.5 = 1187.0
    expect(result.count).toBe(5);
    expect(result.total).toBeCloseTo(1187.0, 2);
  });

  it("returns zero for an empty dataset without throwing", () => {
    const result = computeTodaySalesTotal([], reference, TZ);
    expect(result.total).toBe(0);
    expect(result.count).toBe(0);
  });

  it("ignores null/invalid totals safely", () => {
    const messy: SalesRowForToday[] = [
      { total: null, created_at: "2026-04-25T08:00:00Z" },
      { total: "not-a-number" as unknown as string, created_at: "2026-04-25T08:00:00Z" },
      { total: 10, created_at: "2026-04-25T08:00:00Z" },
    ];
    const result = computeTodaySalesTotal(messy, reference, TZ);
    expect(result.total).toBe(10);
    expect(result.count).toBe(3);
  });
});