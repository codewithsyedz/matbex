import { describe, expect, it } from "vitest";
import { comboLines, priceFor, type PriceRow } from "../../../server/src/modules/pos/pricing";

const row = (selling: number, extra: Partial<PriceRow> = {}): PriceRow => ({ selling, quarter: 0, half: 0, full: 0, ...extra });
const sum = (xs: { lineTotal: number }[]) => Math.round(xs.reduce((a, l) => a + l.lineTotal * 100, 0)) / 100;

describe("priceFor", () => {
  it("uses the tier price, falling back to the regular price", () => {
    expect(priceFor(row(10, { half: 6 }), "half")).toBe(6);
    expect(priceFor(row(10), "quarter")).toBe(10);
  });
});

describe("comboLines", () => {
  const prices = new Map<string, PriceRow>([
    ["burger", row(20, { full: 20, half: 12 })],
    ["fries", row(10)],
    ["drink", row(5)],
  ]);
  const combo = (items: { menuItemId: string; quantity: number; portion: string | null }[]) => ({ id: "combo-1", items });

  it("splits the combo price by the items' own prices, to the cent", () => {
    const lines = comboLines(combo([
      { menuItemId: "burger", quantity: 1, portion: "full" },
      { menuItemId: "fries", quantity: 1, portion: null },
      { menuItemId: "drink", quantity: 1, portion: null },
    ]), 1, 28, prices);
    expect(lines.map((l) => [l.menuItemId, l.lineTotal])).toEqual([["burger", 16], ["fries", 8], ["drink", 4]]);
    expect(lines.every((l) => l.comboId === "combo-1")).toBe(true);
    expect(sum(lines)).toBe(28);
  });

  it("adds up exactly when the split leaves odd cents", () => {
    const lines = comboLines(combo([
      { menuItemId: "fries", quantity: 1, portion: null },
      { menuItemId: "fries", quantity: 1, portion: null },
      { menuItemId: "fries", quantity: 1, portion: null },
    ]), 1, 10, prices);
    expect(lines.map((l) => l.lineTotal)).toEqual([3.34, 3.33, 3.33]);
    expect(sum(lines)).toBe(10);
  });

  it("multiplies component quantities by the combos sold and keeps the portion", () => {
    const lines = comboLines(combo([
      { menuItemId: "burger", quantity: 1, portion: "half" },
      { menuItemId: "drink", quantity: 2, portion: null },
    ]), 3, 54, prices);
    expect(lines.map((l) => [l.menuItemId, l.size, l.quantity])).toEqual([["burger", "half", 3], ["drink", "regular", 6]]);
    expect(sum(lines)).toBe(54);
  });

  it("splits by quantity when no component has a price", () => {
    const lines = comboLines(combo([
      { menuItemId: "unknown-a", quantity: 1, portion: null },
      { menuItemId: "unknown-b", quantity: 3, portion: null },
    ]), 1, 8, prices);
    expect(lines.map((l) => l.lineTotal)).toEqual([2, 6]);
  });
});
