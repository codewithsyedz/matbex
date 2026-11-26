/**
 * Split tender (sale_payments): how a sale was paid. Every sale has at least one tender row
 * (backfilled for old sales); a sale paid by several methods has payment_method 'split'.
 * Readers that bucket sales by cash / card use the tenders, so the cash part of a split sale
 * counts as cash and the card part as card.
 */
export interface SaleTenderRow {
  method: string | null;
  amount: number | string | null;
}

export interface SaleWithTenders {
  payment_method: string | null;
  total: number | string | null;
  sale_payments?: SaleTenderRow[] | null;
}

/** The sale's tenders; a row read without tenders counts as one tender of its own method. */
export function tendersOf(sale: SaleWithTenders): { method: string; amount: number }[] {
  const rows = sale.sale_payments ?? [];
  if (rows.length) return rows.map((r) => ({ method: String(r.method ?? "other"), amount: Number(r.amount) || 0 }));
  return [{ method: String(sale.payment_method ?? "other"), amount: Number(sale.total) || 0 }];
}

/** Amount paid by each method, e.g. { cash: 60, card: 40 }. */
export function amountsByMethod(sales: SaleWithTenders[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of sales) {
    for (const t of tendersOf(s)) out[t.method] = Math.round(((out[t.method] ?? 0) + t.amount) * 100) / 100;
  }
  return out;
}
