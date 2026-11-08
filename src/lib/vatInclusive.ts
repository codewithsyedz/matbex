/**
 * Pricing mode is a per-branch setting (`branches.prices_vat_inclusive`):
 *
 *  - INCLUSIVE (default): the listed menu price is what the customer pays —
 *    VAT is backed out of it, never added on top.
 *  - EXCLUSIVE: the listed price is net and VAT is added on top at checkout.
 *
 * All POS/receipt math funnels through the helpers below so switching the
 * mode never double-taxes or under-taxes a sale.
 */
export const VAT_RATE = 0.15;

/** Default pricing mode for branches that have no explicit setting. */
export const DEFAULT_PRICES_VAT_INCLUSIVE = true;

/** Money precision used everywhere in POS math (2 decimals / nearest cent). */
export const MONEY_DECIMALS = 2;

/**
 * Half-up rounding to the nearest cent. Every monetary value that is
 * displayed, printed, persisted or sent to ZATCA must pass through this so
 * net + VAT always reconciles to the gross with no floating-point drift.
 */
export function roundMoney(value: number): number {
  if (!isFinite(value) || !value) return 0;
  const sign = value < 0 ? -1 : 1;
  return (sign * Math.round(Math.abs(value) * 100 + Number.EPSILON)) / 100;
}

/** Net (tax-exclusive) amount contained in a VAT-inclusive gross amount. */
export function netFromGross(gross: number, rate: number = VAT_RATE): number {
  const g = roundMoney(gross);
  if (!g) return 0;
  return roundMoney(g / (1 + rate));
}

/** VAT portion contained in a VAT-inclusive gross amount. */
export function vatFromGross(gross: number, rate: number = VAT_RATE): number {
  const g = roundMoney(gross);
  if (!g) return 0;
  // Derived from the rounded net so net + VAT === gross exactly.
  return roundMoney(g - netFromGross(g, rate));
}

/** Rounded gross total for a cart line (unit price is VAT-inclusive). */
export function lineGross(unitPrice: number, quantity: number): number {
  return roundMoney(roundMoney(unitPrice) * (Number(quantity) || 0));
}

/** Consistent { gross, net, vat } split of a VAT-inclusive amount. */
export function splitInclusive(gross: number, rate: number = VAT_RATE) {
  const g = roundMoney(gross);
  const net = netFromGross(g, rate);
  return { gross: g, net, vat: roundMoney(g - net) };
}

/** Sum of already-rounded amounts, rounded again to kill accumulation drift. */
export function sumMoney(values: number[]): number {
  return roundMoney(values.reduce((s, v) => s + roundMoney(v), 0));
}

/** Gross (customer-payable) amount for a listed price under a pricing mode. */
export function grossFromListed(
  listed: number,
  rate: number = VAT_RATE,
  inclusive: boolean = DEFAULT_PRICES_VAT_INCLUSIVE,
): number {
  const v = roundMoney(listed);
  if (!v) return 0;
  return inclusive ? v : roundMoney(v * (1 + rate));
}

/** Net (tax-exclusive) amount for a listed price under a pricing mode. */
export function netFromListed(
  listed: number,
  rate: number = VAT_RATE,
  inclusive: boolean = DEFAULT_PRICES_VAT_INCLUSIVE,
): number {
  const v = roundMoney(listed);
  if (!v) return 0;
  return inclusive ? netFromGross(v, rate) : v;
}

/**
 * Canonical { gross, net, vat } split of a LISTED amount, honouring the
 * branch pricing mode. Persisted `total` is always the gross, `subtotal` the
 * net and `tax` the VAT — regardless of how prices are entered.
 */
export function splitListed(
  listed: number,
  rate: number = VAT_RATE,
  inclusive: boolean = DEFAULT_PRICES_VAT_INCLUSIVE,
) {
  if (inclusive) return splitInclusive(listed, rate);
  const net = roundMoney(listed);
  const gross = roundMoney(net * (1 + rate));
  return { gross, net, vat: roundMoney(gross - net) };
}

/**
 * Canonical money string: always exactly two decimals, grouped thousands,
 * and rounded with the same half-up rule used by all POS math so what is
 * displayed/printed matches the persisted amounts to the cent.
 */
export function formatMoneyAmount(value: number): string {
  const n = roundMoney(Number(value) || 0);
  return (Object.is(n, -0) ? 0 : n).toLocaleString("en-US", {
    minimumFractionDigits: MONEY_DECIMALS,
    maximumFractionDigits: MONEY_DECIMALS,
  });
}

/**
 * Canonical VAT-inclusive view of a persisted sale row.
 *
 * `sales_transactions.total` is ALWAYS the gross the guest paid, in both
 * pricing modes (inclusive branches back VAT out of the listed price,
 * exclusive branches add it on top before persisting). So the total is the
 * single source of truth here and is never re-derived from `subtotal` —
 * doing that silently strips the VAT off correctly-saved rows.
 *
 * `tax` is trusted when it reconciles (net + VAT === gross); otherwise the
 * gross is split at the branch VAT rate.
 *
 * Always returns { gross, net, vat } with gross = net + vat.
 */
export function normalizeSaleTotals(
  sale: { subtotal?: number | null; tax?: number | null; total?: number | null },
  rate: number = VAT_RATE,
  _inclusive: boolean = DEFAULT_PRICES_VAT_INCLUSIVE,
): { gross: number; net: number; vat: number } {
  const gross = roundMoney(Number(sale.total) || 0);
  const tax = roundMoney(Number(sale.tax) || 0);
  if (!gross) return { gross: 0, net: 0, vat: 0 };

  const net = roundMoney(gross - tax);
  if (tax > 0 && net > 0 && Math.abs(net + tax - gross) < 0.02) {
    return { gross, net, vat: tax };
  }
  return splitInclusive(gross, rate);
}

/** VAT-inclusive amount a guest paid for a persisted sale row. */
export function saleGrossTotal(
  sale: { subtotal?: number | null; tax?: number | null; total?: number | null },
  rate: number = VAT_RATE,
  inclusive: boolean = DEFAULT_PRICES_VAT_INCLUSIVE,
): number {
  return normalizeSaleTotals(sale, rate, inclusive).gross;
}
