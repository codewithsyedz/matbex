/**
 * The totals block of a printed POS receipt (src/lib/printUtils.ts: Subtotal, Discount, VAT,
 * Total), from the sale's listed amounts. The receipt must say what the customer paid and what
 * the ZATCA invoice says: total and VAT are the sale's (same rounding as the API, or the
 * recorded values when given); the discount row is the document discount with VAT; the
 * subtotal is what the lines come to before it (surcharge included), so the rows add up:
 * subtotal − discount = total.
 */
import { grossFromListed, roundMoney, splitListed } from "../vatInclusive";

export function receiptTotals({
  linesListed,
  documentDiscount = 0,
  documentSurcharge = 0,
  vatRate,
  pricesInclusive,
  recorded,
}: {
  /** Sum of the lines at listed prices (the pricing mode of the branch). */
  linesListed: number;
  documentDiscount?: number;
  documentSurcharge?: number;
  /** Decimal, e.g. 0.15. */
  vatRate: number;
  pricesInclusive: boolean;
  /** What the server recorded, when the sale was saved online. */
  recorded?: { tax?: number | null; total?: number | null } | null;
}) {
  const listed = Math.max(0, roundMoney(linesListed - documentDiscount + documentSurcharge));
  const computed = splitListed(listed, vatRate, pricesInclusive);
  const total = recorded?.total != null && Number.isFinite(Number(recorded.total)) ? roundMoney(Number(recorded.total)) : computed.gross;
  const tax = recorded?.tax != null && Number.isFinite(Number(recorded.tax)) ? roundMoney(Number(recorded.tax)) : computed.vat;
  const discount = documentDiscount > 0 ? grossFromListed(documentDiscount, vatRate, pricesInclusive) : 0;
  return { subtotal: roundMoney(total + discount), discount: discount || null, tax, total };
}
