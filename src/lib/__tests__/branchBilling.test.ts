import { describe, expect, it } from "vitest";
import { billedQuantity, isBranchBilledPlan, quantityChange } from "../../../server/functions/_shared/branchBillingPlan";

const PLAN = "price_starter";

describe("per-branch billing", () => {
  it("bills Starter and Growth, not Enterprise, legacy free or trial", () => {
    expect(isBranchBilledPlan("starter")).toBe(true);
    expect(isBranchBilledPlan("pro")).toBe(true);
    expect(["enterprise", "free", "trial", null].some((p) => isBranchBilledPlan(p))).toBe(false);
  });

  it("bills at least one branch", () => {
    expect(billedQuantity(0)).toBe(1);
    expect(billedQuantity(3)).toBe(3);
  });

  it("changes only the plan item, only when the count differs", () => {
    const items = [
      { id: "si_plan", priceId: PLAN, quantity: 1 },
      { id: "si_addon", priceId: "price_addon", quantity: 1 },
    ];
    expect(quantityChange(items, [PLAN], 3)).toEqual({ itemId: "si_plan", from: 1, to: 3 });
    expect(quantityChange(items, [PLAN], 1)).toBeNull();
    expect(quantityChange([{ id: "si_plan", priceId: PLAN, quantity: 3 }], [PLAN], 2)).toEqual({ itemId: "si_plan", from: 3, to: 2 });
  });

  it("leaves subscriptions without exactly one plan item alone", () => {
    expect(quantityChange([{ id: "x", priceId: "price_other", quantity: 1 }], [PLAN], 4)).toBeNull();
    expect(quantityChange([
      { id: "a", priceId: PLAN, quantity: 1 },
      { id: "b", priceId: PLAN, quantity: 1 },
    ], [PLAN], 4)).toBeNull();
  });
});
