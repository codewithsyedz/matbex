import { describe, expect, it } from "vitest";
import { qk, isDashboardKey } from "../queryKeys";
import { dashboardQueryOptions, STALE_TIME } from "../queryPolicy";

describe("query key factory", () => {
  it("gives each scope its own independent cache entry", () => {
    const a = qk.dashboard.entity("salesAgg", { restaurantId: "r1", branchId: "b1", extra: ["d1", "d2"] });
    const b = qk.dashboard.entity("salesAgg", { restaurantId: "r1", branchId: "b2", extra: ["d1", "d2"] });
    expect(a).not.toEqual(b);
    expect(a).toEqual(["dashboard", "salesAgg", "r1", "b1", "d1", "d2"]);
  });

  it("normalizes undefined to null so keys stay stable across renders", () => {
    expect(qk.dashboard.entity("drawers", { restaurantId: "r1" })).toEqual(["dashboard", "drawers", "r1", null]);
  });

  it("builds prefixes that match the full key", () => {
    const full = qk.dailyProfit.entity("sales", { restaurantId: "r1", branchId: "b1", extra: ["2026-08-04"] });
    const prefix = qk.dailyProfit.entityAll("sales", "r1");
    expect(full.slice(0, prefix.length)).toEqual(prefix);
    // Restaurant-agnostic prefix must omit the id, not pass null.
    expect(qk.dailyProfit.entityAll("sales")).toEqual(["daily-profit", "sales"]);
  });

  it("marks dashboard namespaces as cacheable", () => {
    expect(isDashboardKey(qk.profitLoss.entity("sales", { restaurantId: "r1" }))).toBe(true);
    expect(isDashboardKey(["device-licenses", "r1"])).toBe(false);
  });
});

describe("dashboard query policy", () => {
  it("disables focus refetching and keeps previous data", () => {
    const o = dashboardQueryOptions();
    expect(o.refetchOnWindowFocus).toBe(false);
    expect(o.staleTime).toBe(STALE_TIME.dashboard);
    expect(o.placeholderData).toBeTypeOf("function");
  });

  it("allows opting out of keepPreviousData", () => {
    expect(dashboardQueryOptions({ keepPrevious: false }).placeholderData).toBeUndefined();
  });
});
