import { describe, expect, it } from "vitest";
import {
  assignAll,
  assignUnit,
  assignmentComplete,
  billPartLabels,
  emptyAssignment,
  evenSplit,
  guestLines,
  localPartTotals,
  resizeAssignment,
  spreadAmount,
  toSaleLine,
  unassignUnit,
  unassigned,
  type BillLine,
} from "../billSplit";
import { sumMoney } from "@/lib/vatInclusive";

const burger: BillLine = { key: "0:b", menuItemId: "b", name: "Burger", size: "regular", quantity: 3, unitPrice: 25 };
const coffee: BillLine = { key: "1:c", menuItemId: "c", name: "Coffee", size: "regular", quantity: 1, unitPrice: 12 };
const combo: BillLine = { key: "2:k", comboId: "k", name: "Meal", size: "regular", quantity: 1, unitPrice: 40 };

describe("evenSplit", () => {
  it("splits to the cent, the last payment takes the remainder", () => {
    expect(evenSplit(100, 3)).toEqual([33.33, 33.33, 33.34]);
    expect(evenSplit(100, 4)).toEqual([25, 25, 25, 25]);
    expect(evenSplit(0.05, 3)).toEqual([0.01, 0.01, 0.03]);
    expect(evenSplit(57.5, 2)).toEqual([28.75, 28.75]);
  });
  it("always adds up to the total", () => {
    for (const [total, n] of [[115.01, 7], [9.99, 10], [1234.56, 9], [0.1, 2]] as const) {
      const parts = evenSplit(total, n);
      expect(parts).toHaveLength(n);
      expect(sumMoney(parts)).toBe(total);
      expect(parts.every((p) => p >= 0)).toBe(true);
    }
  });
});

describe("spreadAmount (discount spreading, shared with the server)", () => {
  it("spreads in proportion to the parts' lines, rounding on the last part", () => {
    expect(spreadAmount(10, [60, 40])).toEqual([6, 4]);
    expect(spreadAmount(10, [1, 1, 1])).toEqual([3.33, 3.33, 3.34]);
    expect(spreadAmount(0, [5, 5])).toEqual([0, 0]);
  });
});

describe("assigning items to guests", () => {
  it("moves units of a line to guests and back", () => {
    let a = emptyAssignment(2);
    expect(unassigned(burger, a)).toBe(3);
    a = assignUnit(a, burger, 0);
    a = assignUnit(a, burger, 1);
    a = assignAll(a, burger, 1);
    expect(unassigned(burger, a)).toBe(0);
    expect(guestLines([burger], a, 0)).toEqual([{ ...burger, quantity: 1 }]);
    expect(guestLines([burger], a, 1)).toEqual([{ ...burger, quantity: 2 }]);
    // No unit left to give.
    expect(assignUnit(a, burger, 0)).toBe(a);
    a = unassignUnit(a, burger, 1);
    expect(unassigned(burger, a)).toBe(1);
  });

  it("is complete only when every unit is given and every guest has something", () => {
    let a = emptyAssignment(2);
    a = assignAll(a, burger, 0);
    a = assignAll(a, coffee, 0);
    expect(assignmentComplete([burger, coffee], a)).toBe(false); // guest 2 has nothing
    a = unassignUnit(a, coffee, 0);
    a = assignUnit(a, coffee, 1);
    expect(assignmentComplete([burger, coffee], a)).toBe(true);
  });

  it("removing a guest returns their units", () => {
    let a = emptyAssignment(3);
    a = assignUnit(a, burger, 2);
    a = resizeAssignment(a, 2);
    expect(a).toHaveLength(2);
    expect(unassigned(burger, a)).toBe(3);
    expect(resizeAssignment(a, 1)).toHaveLength(2);
  });
});

describe("localPartTotals (offline: same arithmetic as the server)", () => {
  it("spreads the discount and splits VAT per part (prices include VAT)", () => {
    const parts = [[{ ...burger, quantity: 2 }], [{ ...burger, quantity: 1 }, coffee]];
    const totals = localPartTotals(parts, { documentDiscount: 8.7, vatRate: 0.15, pricesInclusive: true });
    // Lines: 50 and 37; discount 8.70 spread 5.00 / 3.70.
    expect(totals.map((t) => t.documentDiscount)).toEqual([5, 3.7]);
    expect(totals.map((t) => t.total)).toEqual([45, 33.3]);
    for (const t of totals) expect(Math.round((t.subtotal + t.tax) * 100) / 100).toBe(t.total);
  });

  it("adds VAT on top when prices exclude it", () => {
    const [one] = localPartTotals([[coffee]], { vatRate: 0.15, pricesInclusive: false });
    expect(one).toEqual({ subtotal: 12, tax: 1.8, total: 13.8, documentDiscount: 0, documentSurcharge: 0 });
  });
});

describe("request lines and sales-list badges", () => {
  it("sends combos as comboId and items with their size", () => {
    expect(toSaleLine(combo)).toEqual({ comboId: "k", quantity: 1, unitPrice: 40 });
    expect(toSaleLine({ ...burger, size: "half" })).toEqual({ menuItemId: "b", size: "half", quantity: 3, unitPrice: 25 });
  });

  it("numbers bill siblings by receipt number", () => {
    const labels = billPartLabels([
      { id: "x2", bill_group_id: "g", receipt_number: "RCP-20261123-0012" },
      { id: "x1", bill_group_id: "g", receipt_number: "RCP-20261123-0011" },
      { id: "y", bill_group_id: null, receipt_number: "RCP-20261123-0013" },
      { id: "x3", bill_group_id: "g", receipt_number: "RCP-20261123-0014" },
    ]);
    expect(labels.get("x1")).toEqual({ index: 1, count: 3 });
    expect(labels.get("x2")).toEqual({ index: 2, count: 3 });
    expect(labels.get("x3")).toEqual({ index: 3, count: 3 });
    expect(labels.has("y")).toBe(false);
  });
});
