/**
 * Line pricing shared by POST /api/v1/pos/sales and /quote. No database access, so it is
 * unit-tested directly (src/lib/__tests__/posPricing.test.ts).
 */
import type { SaleLineSize } from "./sales.schema.js";
import { roundMoney } from "../../../../src/lib/vatInclusive.ts";

export type PriceRow = { selling: number; quarter: number; half: number; full: number };

/** Same tier rule as the POS cart (RecordSale addToCart): a missing tier falls back to the regular price. */
export function priceFor(p: PriceRow, size: SaleLineSize = "regular"): number {
  if (size === "quarter" && p.quarter > 0) return p.quarter;
  if (size === "half" && p.half > 0) return p.half;
  if (size === "full" && p.full > 0) return p.full;
  return p.selling;
}

export type PricedLine = { menuItemId: string; size: SaleLineSize; quantity: number; unitPrice: number; lineTotal: number; comboId: string | null };
const SIZES = new Set<SaleLineSize>(["regular", "quarter", "half", "full"]);

/**
 * A combo sold `quantity` times for `total`: one line per component item (quantity times the
 * component's quantity), sharing the total in proportion to the components' own prices, to the
 * cent (largest remainder), so the lines add up to exactly what the customer was charged.
 * Stock, COGS and kitchen tickets then work per item; combo_id keeps the lines together.
 */
export function comboLines(
  combo: { id: string; items: { menuItemId: string; quantity: number; portion: string | null }[] },
  quantity: number,
  total: number,
  prices: Map<string, PriceRow>,
): PricedLine[] {
  const parts = combo.items.map((i) => {
    const size = (SIZES.has(i.portion as SaleLineSize) ? i.portion : "regular") as SaleLineSize;
    const qty = Math.max(1, Number(i.quantity) || 1) * quantity;
    const listPrice = prices.get(i.menuItemId) ? priceFor(prices.get(i.menuItemId)!, size) : 0;
    return { menuItemId: i.menuItemId, size, qty, weight: listPrice * qty };
  });
  const weights = parts.some((p) => p.weight > 0) ? parts.map((p) => p.weight) : parts.map((p) => p.qty);
  const sum = weights.reduce((a, b) => a + b, 0);
  const cents = Math.round(total * 100);
  const raw = weights.map((w) => (cents * w) / sum);
  const share = raw.map(Math.floor);
  let left = cents - share.reduce((a, b) => a + b, 0);
  raw.map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i)
    .forEach(({ i }) => { if (left > 0) { share[i] += 1; left -= 1; } });
  return parts.map((p, i) => ({
    menuItemId: p.menuItemId,
    size: p.size,
    quantity: p.qty,
    unitPrice: roundMoney(share[i] / 100 / p.qty),
    lineTotal: share[i] / 100,
    comboId: combo.id,
  }));
}

