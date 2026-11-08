import { format } from "date-fns";
import type { VatReturnComputation } from "./vatReturn";

export interface VatPdfMeta {
  restaurantName: string;
  periodStart: Date;
  periodEnd: Date;
  basis?: string;
  currency?: string;
  arabic?: boolean;
  periodCode?: string;
}

const fmt = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const vatCell = (amount: number, adj: number, rate: number | null) =>
  rate != null ? fmt((amount + adj) * rate) : "";

export function exportVatReturnPdf(result: VatReturnComputation, meta: VatPdfMeta) {
  const { restaurantName, periodStart, periodEnd, basis = "Accrual", currency = "SAR", arabic = false, periodCode } = meta;

  const salesRows = result.sales
    .map(
      (r) => `
      <tr>
        <td>${r.number}</td>
        <td>${r.description}</td>
        <td class="num">${fmt(r.amount)}</td>
        <td class="num">${fmt(r.adjustment)}</td>
        <td class="num">${vatCell(r.amount, r.adjustment, r.vatRate)}</td>
      </tr>`,
    )
    .join("");

  const purchaseRows = result.purchases
    .map(
      (r) => `
      <tr>
        <td>${r.number}</td>
        <td>${r.description}</td>
        <td class="num">${fmt(r.amount)}</td>
        <td class="num">${fmt(r.adjustment)}</td>
        <td class="num">${vatCell(r.amount, r.adjustment, r.vatRate)}</td>
      </tr>`,
    )
    .join("");

  const html = `<!DOCTYPE html>
<html lang="${arabic ? "ar" : "en"}" dir="${arabic ? "rtl" : "ltr"}">
<head>
<meta charset="utf-8" />
<title>VAT Return ${format(periodStart, "dd MMM yyyy")} – ${format(periodEnd, "dd MMM yyyy")}</title>
<style>
  body { font-family: -apple-system, Arial, sans-serif; padding: 24px; color: #111; }
  h1 { font-size: 18px; margin: 0; }
  h2 { font-size: 14px; margin: 20px 0 6px; }
  .meta { color: #555; font-size: 12px; margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 6px; }
  th, td { border: 1px solid #ccc; padding: 6px 8px; }
  th { background: #f3f4f6; text-align: left; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  tr.total td { font-weight: 700; background: #fafafa; }
  .footer { margin-top: 18px; font-size: 11px; color: #555; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
  <h1>${restaurantName}</h1>
  <div class="meta">VAT Return${periodCode ? ` &middot; ${periodCode}` : ""} &middot; Basis: ${basis}</div>
  <div class="meta">From ${format(periodStart, "dd MMM yyyy")} To ${format(periodEnd, "dd MMM yyyy")}</div>

  <h2>VAT on Sales</h2>
  <table>
    <thead>
      <tr><th style="width:60px">Box#</th><th>Description</th><th class="num">Amount</th><th class="num">Adjustment</th><th class="num">VAT Amount</th></tr>
    </thead>
    <tbody>
      ${salesRows}
      <tr class="total">
        <td>6</td>
        <td>Total Sales</td>
        <td class="num">${fmt(result.totals.salesAmount)}</td>
        <td class="num">${fmt(result.totals.salesAdjustment)}</td>
        <td class="num">${fmt(result.totals.salesVat)}</td>
      </tr>
    </tbody>
  </table>

  <h2>VAT on Purchases</h2>
  <table>
    <thead>
      <tr><th style="width:60px">Box#</th><th>Description</th><th class="num">Amount</th><th class="num">Adjustment</th><th class="num">VAT Amount</th></tr>
    </thead>
    <tbody>
      ${purchaseRows}
      <tr class="total">
        <td>12</td>
        <td>Total purchases</td>
        <td class="num">${fmt(result.totals.purchasesAmount)}</td>
        <td class="num">${fmt(result.totals.purchasesAdjustment)}</td>
        <td class="num">${fmt(result.totals.purchasesVat)}</td>
      </tr>
    </tbody>
  </table>

  <h2>Net VAT due</h2>
  <table>
    <thead>
      <tr><th style="width:60px">Box#</th><th>Description</th><th class="num">VAT Amount</th></tr>
    </thead>
    <tbody>
      <tr><td>13</td><td>Total VAT due for current period</td><td class="num">${fmt(result.totals.netVatBeforeCorrections)}</td></tr>
      <tr><td>14</td><td>Corrections from previous period (between SAR -15,000 and SAR 15,000)</td><td class="num">${fmt(result.corrections)}</td></tr>
      <tr><td>15</td><td>VAT credit carried forward from previous period(s)</td><td class="num">${fmt(result.creditCarried)}</td></tr>
      <tr class="total"><td>16</td><td>Net VAT due (or claim)</td><td class="num">${fmt(result.totals.netVatDue)}</td></tr>
    </tbody>
  </table>

  <div class="footer">Amount is displayed in your base currency ${currency}. Generated ${format(new Date(), "PPP 'at' p")}.</div>

  <script>window.print();</script>
</body>
</html>`;

  const w = window.open("", "_blank");
  if (w) {
    w.document.write(html);
    w.document.close();
  }
}