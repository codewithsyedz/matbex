import { describe, expect, it } from "vitest";
import { balanceAmounts, distributeEqually, isBalanced } from "../splitBalance";

const sum = (a: number[]) => Math.round(a.reduce((s, v) => s + v, 0) * 100) / 100;

describe("distributeEqually", () => {
  it("splits evenly and puts the residual on the last line", () => {
    expect(distributeEqually(100, 3)).toEqual([33.33, 33.33, 33.34]);
    expect(sum(distributeEqually(1000.01, 7))).toBe(1000.01);
  });
  it("handles zero lines", () => {
    expect(distributeEqually(100, 0)).toEqual([]);
  });
});

describe("balanceAmounts", () => {
  it("scales the other lines pro-rata around the edited line", () => {
    const out = balanceAmounts([600, 200, 200], 1000, 0);
    expect(out[0]).toBe(600);
    expect(sum(out)).toBe(1000);
  });
  it("spreads equally when the other lines are zero", () => {
    const out = balanceAmounts([400, 0, 0], 1000, 0);
    expect(out).toEqual([400, 300, 300]);
  });
  it("balances all lines when nothing is locked", () => {
    expect(sum(balanceAmounts([100, 100], 333.33))).toBe(333.33);
  });
  it("returns the total when only the locked line exists", () => {
    expect(balanceAmounts([50], 120, 0)).toEqual([120]);
  });
  it("reports balance within tolerance", () => {
    expect(isBalanced([33.33, 33.33, 33.34], 100)).toBe(true);
    expect(isBalanced([33.33, 33.33], 100)).toBe(false);
  });
});

describe("variance helpers", () => {
  it("classifies rounding noise vs a real gap", async () => {
    const { classifyVariance, residual, applyResidualToLargest } = await import("../splitBalance");
    expect(classifyVariance([500, 499.7], 1000)).toBe("rounding");
    expect(classifyVariance([500, 400], 1000)).toBe("gap");
    expect(classifyVariance([500, 500], 1000)).toBe("balanced");
    expect(residual([500, 499.7], 1000)).toBe(0.3);
    expect(applyResidualToLargest([500, 499.7], 1000)).toEqual([500.3, 499.7]);
    expect(applyResidualToLargest([100, 200, 300], 605)).toEqual([100, 200, 305]);
  });
});
