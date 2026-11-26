/**
 * Split bill at checkout (docs/plans/split-payments.md, phase 2a): pure helpers for the POS
 * "Split bill" sheet. The server (server/src/modules/pos/bill-split.ts) uses spreadAmount from
 * here, so the totals the cashier sees and the ones recorded round the same way.
 *
 * - By item: cart units are assigned to guests 1..N; each guest's part becomes its own sale
 *   (POST /api/v1/pos/sales/bill-split records them together).
 * - Evenly / by amount: one sale paid by N tenders (phase 1 split tender); evenSplit gives N
 *   amounts that add up to the total, the last one taking the rounding remainder.
 */
import { lineGross, roundMoney, splitListed, sumMoney } from "../vatInclusive";

export type BillLineSize = "regular" | "quarter" | "half" | "full";

/** One cart line as the split sheet sees it. */
export interface BillLine {
  /** Stable key for the line within this cart. */
  key: string;
  menuItemId?: string;
  comboId?: string;
  name: string;
  size: BillLineSize;
  quantity: number;
  unitPrice: number;
}

export const MAX_GUESTS = 20;
/** Evenly / by amount pay one sale with N tenders; the server takes at most 10 per sale. */
export const MAX_EVEN_GUESTS = 10;

/**
 * `amount` spread over parts weighted by `weights`, in cents, each share rounded down; the
 * last part takes what rounding leaves, so the shares add up to exactly `amount`. With no
 * weight at all the whole amount goes to the last part.
 */
export function spreadAmount(amount: number, weights: number[]): number[] {
  const cents = Math.round(roundMoney(amount) * 100);
  if (!weights.length) return [];
  const sum = weights.reduce((a, b) => a + Math.max(0, b), 0);
  const shares = weights.map((w, i) => {
    if (i === weights.length - 1) return 0;
    // Rounded down, so the last part's share (the remainder) can never go negative.
    return sum > 0 ? Math.floor((cents * Math.max(0, w)) / sum + 1e-9) : 0;
  });
  shares[shares.length - 1] = cents - shares.reduce((a, b) => a + b, 0);
  return shares.map((c) => c / 100);
}

/** `total` in `n` equal payments to the cent; the last one takes the rounding remainder. */
export function evenSplit(total: number, n: number): number[] {
  const count = Math.max(1, Math.floor(n));
  const cents = Math.round(roundMoney(total) * 100);
  const each = Math.floor(cents / count);
  return Array.from({ length: count }, (_, i) => (i === count - 1 ? cents - each * (count - 1) : each) / 100);
}

/** Units of each line per guest: assignment[guest][lineKey] = units. */
export type Assignment = Record<string, number>[];

export function emptyAssignment(guests: number): Assignment {
  return Array.from({ length: guests }, () => ({}));
}

/** Units of `line` not yet given to any guest. */
export function unassigned(line: BillLine, a: Assignment): number {
  return line.quantity - a.reduce((s, g) => s + (g[line.key] ?? 0), 0);
}

/** Moves one unit of `line` to `guest` (from the unassigned units); no-op when none is left. */
export function assignUnit(a: Assignment, line: BillLine, guest: number): Assignment {
  if (unassigned(line, a) <= 0 || guest < 0 || guest >= a.length) return a;
  return a.map((g, i) => (i === guest ? { ...g, [line.key]: (g[line.key] ?? 0) + 1 } : g));
}

/** Gives every unassigned unit of `line` to `guest`. */
export function assignAll(a: Assignment, line: BillLine, guest: number): Assignment {
  const left = unassigned(line, a);
  if (left <= 0 || guest < 0 || guest >= a.length) return a;
  return a.map((g, i) => (i === guest ? { ...g, [line.key]: (g[line.key] ?? 0) + left } : g));
}

/** Takes one unit of `line` back from `guest`. */
export function unassignUnit(a: Assignment, line: BillLine, guest: number): Assignment {
  if (!(a[guest]?.[line.key] > 0)) return a;
  return a.map((g, i) => (i === guest ? { ...g, [line.key]: g[line.key] - 1 } : g));
}

/** Sets the number of guests; units of removed guests go back to unassigned. */
export function resizeAssignment(a: Assignment, guests: number): Assignment {
  const n = Math.min(MAX_GUESTS, Math.max(2, guests));
  return n <= a.length ? a.slice(0, n) : [...a, ...emptyAssignment(n - a.length)];
}

/** The lines of `guest`'s part (same identity and price as the cart line). */
export function guestLines(lines: BillLine[], a: Assignment, guest: number): BillLine[] {
  return lines.flatMap((l) => {
    const q = a[guest]?.[l.key] ?? 0;
    return q > 0 ? [{ ...l, quantity: q }] : [];
  });
}

/** Ready to pay when every unit is assigned and every guest has something. */
export function assignmentComplete(lines: BillLine[], a: Assignment): boolean {
  return lines.every((l) => unassigned(l, a) === 0) && a.every((_, g) => guestLines(lines, a, g).length > 0);
}

export interface PartTotals {
  subtotal: number;
  tax: number;
  total: number;
  documentDiscount: number;
  documentSurcharge: number;
}

/**
 * What each part costs at the terminal's prices, with the cart's discount/surcharge spread the
 * way the server spreads it. Used offline (the server charges offline replays at these prices)
 * and to show totals while the server quote loads.
 */
export function localPartTotals(
  parts: BillLine[][],
  { documentDiscount = 0, documentSurcharge = 0, vatRate, pricesInclusive }: { documentDiscount?: number; documentSurcharge?: number; vatRate: number; pricesInclusive: boolean },
): PartTotals[] {
  const linesTotals = parts.map((p) => sumMoney(p.map((l) => lineGross(l.unitPrice, l.quantity))));
  const discounts = spreadAmount(documentDiscount, linesTotals);
  const surcharges = spreadAmount(documentSurcharge, linesTotals);
  return parts.map((_, i) => {
    const listed = roundMoney(linesTotals[i] - discounts[i] + surcharges[i]);
    const { net, vat, gross } = splitListed(Math.max(0, listed), vatRate, pricesInclusive);
    return { subtotal: net, tax: vat, total: gross, documentDiscount: discounts[i], documentSurcharge: surcharges[i] };
  });
}

/** A line in the API's request shape. */
export function toSaleLine(l: BillLine) {
  return l.comboId
    ? { comboId: l.comboId, quantity: l.quantity, unitPrice: l.unitPrice }
    : { menuItemId: l.menuItemId!, size: l.size, quantity: l.quantity, unitPrice: l.unitPrice };
}

/** "1 of 3" badges on the sales list: each sale's place among its bill siblings (by receipt number). */
export function billPartLabels(rows: { id: string; bill_group_id?: string | null; receipt_number?: string | null }[]) {
  const groups = new Map<string, { id: string; receipt: string }[]>();
  for (const r of rows) {
    if (!r.bill_group_id) continue;
    const g = groups.get(r.bill_group_id) ?? [];
    g.push({ id: r.id, receipt: r.receipt_number ?? "" });
    groups.set(r.bill_group_id, g);
  }
  const out = new Map<string, { index: number; count: number }>();
  for (const g of groups.values()) {
    g.sort((x, y) => x.receipt.localeCompare(y.receipt, undefined, { numeric: true }));
    g.forEach((s, i) => out.set(s.id, { index: i + 1, count: g.length }));
  }
  return out;
}
