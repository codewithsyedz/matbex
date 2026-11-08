import { describe, it, expect } from "vitest";
import { getRestaurantDayBoundsUTC, formatZonedYMD } from "@/lib/timezone";

describe("getRestaurantDayBoundsUTC", () => {
  it("returns Riyadh (UTC+3) day bounds for a UTC instant inside that day", () => {
    // 2026-04-25 10:00 UTC -> 13:00 Riyadh (same calendar day)
    const ref = new Date("2026-04-25T10:00:00Z");
    const { start, endExclusive } = getRestaurantDayBoundsUTC(ref, "Asia/Riyadh");

    // Local midnight 2026-04-25 in Riyadh = 2026-04-24T21:00:00Z
    expect(start.toISOString()).toBe("2026-04-24T21:00:00.000Z");
    // Next local midnight = 2026-04-25T21:00:00Z
    expect(endExclusive.toISOString()).toBe("2026-04-25T21:00:00.000Z");
    // Window is exactly 24h
    expect(endExclusive.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it("rolls into the next local day when UTC instant is past local midnight", () => {
    // 2026-04-25T22:00:00Z -> 2026-04-26 01:00 Riyadh (next day)
    const ref = new Date("2026-04-25T22:00:00Z");
    const { start, endExclusive } = getRestaurantDayBoundsUTC(ref, "Asia/Riyadh");

    expect(start.toISOString()).toBe("2026-04-25T21:00:00.000Z");
    expect(endExclusive.toISOString()).toBe("2026-04-26T21:00:00.000Z");
  });

  it("handles a DST timezone (America/New_York) and yields exactly 24h on a normal day", () => {
    const ref = new Date("2026-06-15T15:00:00Z"); // EDT (UTC-4)
    const { start, endExclusive } = getRestaurantDayBoundsUTC(ref, "America/New_York");

    expect(start.toISOString()).toBe("2026-06-15T04:00:00.000Z");
    expect(endExclusive.toISOString()).toBe("2026-06-16T04:00:00.000Z");
  });

  it("formatZonedYMD returns the local calendar date in the target zone", () => {
    // 23:30 UTC = 02:30 next day in Riyadh
    expect(formatZonedYMD(new Date("2026-04-25T23:30:00Z"), "Asia/Riyadh")).toBe("2026-04-26");
    // Same instant in UTC
    expect(formatZonedYMD(new Date("2026-04-25T23:30:00Z"), "UTC")).toBe("2026-04-25");
  });
});