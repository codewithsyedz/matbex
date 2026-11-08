import { format } from "date-fns";

export type BreakdownDetail = "none" | "summary" | "detailed";

export interface SalesPdfOptions {
  breakdownDetail: BreakdownDetail;
  includeUnassigned: boolean;
}

export const DEFAULT_PDF_OPTIONS: SalesPdfOptions = {
  breakdownDetail: "summary",
  includeUnassigned: true,
};

interface SaleRow {
  id: string;
  receipt_number: string | null;
  subtotal: number;
  tax: number;
  total: number;
  payment_method: "cash" | "card" | "other";
  created_at: string;
  shift_id: string | null;
  shift?: { drawers?: { name: string } } | null;
}

export function exportSalesPdf(
  sales: SaleRow[],
  opts: SalesPdfOptions,
  meta: { dateRange: string; currency: string; restaurantName?: string }
) {
  const rows = opts.includeUnassigned ? sales : sales.filter(s => !!s.shift_id);

  const fmt = (n: number) => `${meta.currency} ${n.toFixed(2)}`;

  // Aggregate by payment method
  const totals = { cash: 0, card: 0, other: 0, count: 0, sum: 0 };
  rows.forEach(r => {
    totals[r.payment_method] += Number(r.total) || 0;
    totals.count += 1;
    totals.sum += Number(r.total) || 0;
  });

  // Aggregate by shift (or unassigned)
  const shiftMap = new Map<string, { name: string; cash: number; card: number; other: number; count: number; sum: number }>();
  rows.forEach(r => {
    const key = r.shift_id || "__unassigned__";
    const name = r.shift_id ? (r.shift?.drawers?.name || "Shift") : "Unassigned";
    if (!shiftMap.has(key)) shiftMap.set(key, { name, cash: 0, card: 0, other: 0, count: 0, sum: 0 });
    const e = shiftMap.get(key)!;
    e[r.payment_method] += Number(r.total) || 0;
    e.count += 1;
    e.sum += Number(r.total) || 0;
  });

  const shiftRows = Array.from(shiftMap.values());

  let breakdownHTML = "";
  if (opts.breakdownDetail !== "none") {
    breakdownHTML = `
      <h2>Cash / Card breakdown by shift</h2>
      <table>
        <thead>
          <tr>
            <th>Source</th><th># Tx</th><th>Cash</th><th>Card</th><th>Other</th><th>Total</th>
          </tr>
        </thead>
        <tbody>
          ${shiftRows.map(s => `
            <tr>
              <td>${s.name}</td>
              <td>${s.count}</td>
              <td>${fmt(s.cash)}</td>
              <td>${fmt(s.card)}</td>
              <td>${fmt(s.other)}</td>
              <td><strong>${fmt(s.sum)}</strong></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  }

  let detailedHTML = "";
  if (opts.breakdownDetail === "detailed") {
    detailedHTML = `
      <h2>Transactions</h2>
      <table>
        <thead>
          <tr>
            <th>Date</th><th>Receipt</th><th>Source</th><th>Method</th><th>Subtotal</th><th>Tax</th><th>Total</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td>${format(new Date(r.created_at), "MMM d, yyyy HH:mm")}</td>
              <td>${r.receipt_number || "-"}</td>
              <td>${r.shift_id ? (r.shift?.drawers?.name || "Shift") : "Unassigned"}</td>
              <td>${r.payment_method}</td>
              <td>${fmt(r.subtotal)}</td>
              <td>${fmt(r.tax)}</td>
              <td>${fmt(r.total)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  }

  const html = `<!DOCTYPE html>
<html>
<head>
  <title>Sales Report ${meta.dateRange}</title>
  <style>
    body { font-family: -apple-system, Arial, sans-serif; padding: 24px; color: #111; }
    h1 { font-size: 20px; margin: 0 0 4px; }
    h2 { font-size: 14px; margin: 24px 0 8px; color: #333; }
    .muted { color: #666; font-size: 12px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 8px; }
    th { background: #f5f5f5; border: 1px solid #ddd; padding: 8px; text-align: left; }
    td { border: 1px solid #ddd; padding: 6px 8px; }
    tr:nth-child(even) td { background: #fafafa; }
    .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-top: 12px; }
    .card { border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px; }
    .card .label { font-size: 11px; color: #666; text-transform: uppercase; }
    .card .value { font-size: 16px; font-weight: 600; margin-top: 4px; }
    @media print { body { padding: 0; } }
  </style>
</head>
<body>
  <h1>${meta.restaurantName || "Sales Report"}</h1>
  <div class="muted">Range: ${meta.dateRange} &middot; Generated ${format(new Date(), "PPP 'at' p")}</div>
  <div class="muted">Unassigned transactions: ${opts.includeUnassigned ? "Included" : "Excluded"}</div>

  <div class="summary">
    <div class="card"><div class="label">Total Sales</div><div class="value">${fmt(totals.sum)}</div></div>
    <div class="card"><div class="label">Transactions</div><div class="value">${totals.count}</div></div>
    <div class="card"><div class="label">Cash</div><div class="value">${fmt(totals.cash)}</div></div>
    <div class="card"><div class="label">Card</div><div class="value">${fmt(totals.card)}</div></div>
  </div>

  ${breakdownHTML}
  ${detailedHTML}

  <script>window.print();</script>
</body>
</html>`;

  const w = window.open("", "_blank");
  if (w) {
    w.document.write(html);
    w.document.close();
  }
}