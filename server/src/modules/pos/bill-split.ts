/**
 * Split bill at checkout, by item (docs/plans/split-payments.md, phase 2a): pure rules used by
 * POST /api/v1/pos/sales/bill-split. No database access.
 *
 * - The parts together must be exactly the cart: the same lines (item or combo, size, the
 *   price the terminal showed) in the same quantities. Missing, extra or changed lines are
 *   refused, so a guest's part can never add or drop something the cashier rang up.
 * - A document discount or surcharge on the cart is spread over the parts in proportion to
 *   each part's lines total, to the cent; the last part takes the rounding remainder.
 */
import { HttpError } from "../../lib/errors.js";
import { roundMoney } from "../../../../src/lib/vatInclusive.ts";
import type { CreateSaleInput } from "./sales.schema.js";

export type CartLine = CreateSaleInput["lines"][number];

export const MIN_PARTS = 2;
export const MAX_PARTS = 20;

/** One countable line identity: the same thing at the same price. */
function lineKey(l: CartLine) {
  const what = l.comboId ? `combo:${l.comboId}` : `item:${l.menuItemId}`;
  const price = l.unitPrice == null ? "-" : roundMoney(l.unitPrice).toFixed(2);
  return `${what}|${l.comboId ? "regular" : l.size ?? "regular"}|${price}`;
}

function count(lines: CartLine[]) {
  const m = new Map<string, number>();
  for (const l of lines) m.set(lineKey(l), (m.get(lineKey(l)) ?? 0) + l.quantity);
  return m;
}

/** Throws 400 parts_not_cart unless the parts' lines add up to exactly the cart's. */
export function assertPartsMatchCart(cart: CartLine[], parts: { lines: CartLine[] }[]) {
  if (parts.length < MIN_PARTS) throw new HttpError(400, `A split bill needs at least ${MIN_PARTS} parts`, "too_few_parts");
  if (parts.length > MAX_PARTS) throw new HttpError(400, `A split bill has at most ${MAX_PARTS} parts`, "too_many_parts");
  const empty = parts.findIndex((p) => !p.lines.length);
  if (empty >= 0) throw new HttpError(400, `Part ${empty + 1} has no lines`, "empty_part");

  const want = count(cart);
  const got = count(parts.flatMap((p) => p.lines));
  const missing: { line: string; quantity: number }[] = [];
  const extra: { line: string; quantity: number }[] = [];
  for (const [k, q] of want) {
    const g = got.get(k) ?? 0;
    if (g < q) missing.push({ line: k, quantity: q - g });
    if (g > q) extra.push({ line: k, quantity: g - q });
  }
  for (const [k, g] of got) if (!want.has(k)) extra.push({ line: k, quantity: g });
  if (missing.length || extra.length) {
    throw new HttpError(400, "The parts of a split bill must be exactly the cart", "parts_not_cart", { missing, extra });
  }
}

/** Shared with the POS screen, so both round the discount spreading the same way. */
export { spreadAmount } from "../../../../src/lib/pos/billSplit.ts";
