/**
 * Export helpers for the project Budget tab summary.
 * Produces a CSV file or a printable (PDF-ready) HTML document listing each
 * category with committed, actual, pending, paid and variance figures.
 */
import { format } from "date-fns";
import type { CategoryBreakdownRow } from "@/lib/projectBudgetBreakdown";

export interface BudgetExportInput {
  projectName: string;
  projectCode?: string | null;
  rows: CategoryBreakdownRow[];
  period?: { from?: string | null; to?: string | null; shift?: string | null };
  money: (v: number) => string;
}

const esc = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const html = (v: unknown) =>
  String(v ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] as string);

function periodLabel(period?: BudgetExportInput["period"]) {
  if (!period) return "All dates · all shifts";
  const range =
    period.from || period.to
      ? `${period.from || "start"} → ${period.to || "today"}`
      : "All dates";
  const shift = period.shift && period.shift !== "all" ? `${period.shift} shift` : "all shifts";
  return `${range} · ${shift}`;
}

function totalsOf(rows: CategoryBreakdownRow[]) {
  return rows.reduce(
    (acc, r) => ({
      budget: acc.budget + r.budget,
      committed: acc.committed + r.committed,
      actual: acc.actual + r.actual,
      pending: acc.pending + r.pending,
      paid: acc.paid + r.paid,
      outstanding: acc.outstanding + r.outstanding,
      recorded: acc.recorded + r.recorded,
      variance: acc.variance + r.variance,
    }),
    { budget: 0, committed: 0, actual: 0, pending: 0, paid: 0, outstanding: 0, recorded: 0, variance: 0 },
  );
}

export function buildBudgetFilename(input: BudgetExportInput, ext: "csv" | "pdf") {
  const slug = `${input.projectCode ? `${input.projectCode}_` : ""}${input.projectName}`
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `Project_Budget_${slug}_${format(new Date(), "yyyy-MM-dd")}.${ext}`;
}

export function buildBudgetCsv(input: BudgetExportInput): string {
  const t = totalsOf(input.rows);
  const lines: string[] = [];
  lines.push(["Project", input.projectName].map(esc).join(","));
  if (input.projectCode) lines.push(["Project code", input.projectCode].map(esc).join(","));
  lines.push(["Period", periodLabel(input.period)].map(esc).join(","));
  lines.push(["Generated", format(new Date(), "yyyy-MM-dd HH:mm")].map(esc).join(","));
  lines.push("");
  lines.push(
    ["Category", "Budget", "Committed", "Actual", "Pending", "Pending count", "Paid", "Outstanding", "Recorded", "Variance"].join(","),
  );
  for (const r of input.rows) {
    lines.push(
      [
        r.category,
        r.budget,
        r.committed,
        r.actual,
        r.pending,
        r.pendingCount,
        r.paid,
        r.outstanding,
        r.recorded,
        r.variance,
      ]
        .map(esc)
        .join(","),
    );
  }
  lines.push(
    ["TOTAL", t.budget, t.committed, t.actual, t.pending, "", t.paid, t.outstanding, t.recorded, t.variance]
      .map(esc)
      .join(","),
  );
  return lines.join("\n");
}

export function downloadBudgetCsv(input: BudgetExportInput) {
  const blob = new Blob([buildBudgetCsv(input)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = buildBudgetFilename(input, "csv");
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function buildBudgetHtml(input: BudgetExportInput): string {
  const { money } = input;
  const t = totalsOf(input.rows);
  const body =
    input.rows
      .map(
        (r) => `<tr>
          <td>${html(r.category)}</td>
          <td class="r">${html(money(r.budget))}</td>
          <td class="r">${html(money(r.committed))}</td>
          <td class="r">${html(money(r.actual))}</td>
          <td class="r${r.pending > 0 ? " warn" : ""}">${html(money(r.pending))}</td>
          <td class="r">${html(money(r.paid))}</td>
          <td class="r">${html(money(r.outstanding))}</td>
          <td class="r ${r.variance < 0 ? "bad" : "ok"}">${html(money(r.variance))}</td>
        </tr>`,
      )
      .join("") || `<tr><td colspan="8" class="muted">No categories.</td></tr>`;

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8" />
<title>${html(buildBudgetFilename(input, "pdf").replace(/\.pdf$/, ""))}</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; padding: 24px; color: #111; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  p.meta { color: #666; font-size: 12px; margin: 0 0 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { background: #f5f5f5; border: 1px solid #ddd; padding: 8px; text-align: left; }
  td { border: 1px solid #ddd; padding: 6px 8px; }
  .r { text-align: right; }
  .muted { color: #777; }
  .warn { color: #b45309; }
  .bad { color: #c0392b; }
  .ok { color: #00A859; }
  tr.total td { font-weight: 600; background: #fafafa; }
  @media print { body { padding: 0; } }
</style></head>
<body>
  <h1>Project budget summary</h1>
  <p class="meta">${html(input.projectName)}${input.projectCode ? ` · ${html(input.projectCode)}` : ""} · ${html(
    periodLabel(input.period),
  )} · generated ${html(format(new Date(), "PPP 'at' p"))}</p>
  <table>
    <thead><tr>
      <th>Category</th><th class="r">Budget</th><th class="r">Committed</th><th class="r">Actual</th>
      <th class="r">Pending</th><th class="r">Paid</th><th class="r">Outstanding</th><th class="r">Variance</th>
    </tr></thead>
    <tbody>
      ${body}
      <tr class="total">
        <td>Total</td>
        <td class="r">${html(money(t.budget))}</td>
        <td class="r">${html(money(t.committed))}</td>
        <td class="r">${html(money(t.actual))}</td>
        <td class="r">${html(money(t.pending))}</td>
        <td class="r">${html(money(t.paid))}</td>
        <td class="r">${html(money(t.outstanding))}</td>
        <td class="r">${html(money(t.variance))}</td>
      </tr>
    </tbody>
  </table>
  <script>window.onload = function () { window.print(); };</script>
</body></html>`;
}

export function printBudgetPdf(input: BudgetExportInput) {
  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.write(buildBudgetHtml(input));
  w.document.close();
  return true;
}
