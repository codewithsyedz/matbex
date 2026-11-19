/**
 * Export helpers for the Project Cost vs Funding reconciliation.
 * Produces a CSV file or a printable (PDF-ready) HTML document containing the
 * summary, variance and every contributing / excluded transaction leg.
 */
import { format } from "date-fns";
import type { ReconciliationBreakdown, BreakdownLeg } from "@/lib/projectReconciliationBreakdown";

export interface ReconciliationExportInput {
  projectName: string;
  projectCode?: string | null;
  breakdown: ReconciliationBreakdown;
  summary: {
    costTotal: number;
    fundingTotal: number;
    variance: number;
    balanced: boolean;
    partnerCapital: number;
    partnerLoans: number;
    partnerPayables: number;
    companyFunded: number;
    outstandingVendor: number;
  };
  money: (v: number) => string;
}

const esc = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const html = (v: unknown) =>
  String(v ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] as string);

function sections(b: ReconciliationBreakdown): Array<{ title: string; legs: BreakdownLeg[]; total?: number }> {
  return [
    { title: "Project cost — posted", legs: b.costLegs, total: b.costTotal },
    { title: "Project funding — posted", legs: b.fundingLegs, total: b.fundingTotal },
    { title: "Excluded from reconciliation", legs: b.excludedLegs },
    { title: "Not posted yet (no ledger impact)", legs: b.unpostedLegs },
  ].filter((s) => s.legs.length > 0 || typeof s.total === "number");
}

export function buildReconciliationFilename(input: ReconciliationExportInput, ext: "csv" | "pdf") {
  const slug = `${input.projectCode ? `${input.projectCode}_` : ""}${input.projectName}`
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `Project_Reconciliation_${slug}_${format(new Date(), "yyyy-MM-dd")}.${ext}`;
}

export function buildReconciliationCsv(input: ReconciliationExportInput): string {
  const { summary, breakdown } = input;
  const lines: string[] = [];
  lines.push(["Project", input.projectName].map(esc).join(","));
  if (input.projectCode) lines.push(["Project code", input.projectCode].map(esc).join(","));
  lines.push(["Generated", format(new Date(), "yyyy-MM-dd HH:mm")].map(esc).join(","));
  lines.push("");
  lines.push("Summary,Amount");
  const summaryRows: Array<[string, number]> = [
    ["Total project cost", summary.costTotal],
    ["Total project funding", summary.fundingTotal],
    ["Variance (cost - funding)", summary.variance],
    ["Partner capital", summary.partnerCapital],
    ["Partner loans", summary.partnerLoans],
    ["Due to partners", summary.partnerPayables],
    ["Company funding", summary.companyFunded],
    ["Outstanding vendor payables", summary.outstandingVendor],
  ];
  for (const [label, value] of summaryRows) lines.push([label, value.toFixed(2)].map(esc).join(","));
  lines.push(["Status", summary.balanced ? "Reconciled" : "Not reconciled"].map(esc).join(","));
  lines.push("");
  lines.push("Section,Item,Detail,Date,Amount,Counted in total");
  for (const s of sections(breakdown)) {
    for (const l of s.legs) {
      lines.push(
        [s.title, l.label, l.detail ?? "", l.date ?? "", Number(l.amount).toFixed(2), l.informational ? "No" : "Yes"]
          .map(esc)
          .join(","),
      );
    }
    if (typeof s.total === "number") {
      lines.push([s.title, "Total", "", "", s.total.toFixed(2), "Yes"].map(esc).join(","));
    }
  }
  return lines.join("\n");
}

export function downloadReconciliationCsv(input: ReconciliationExportInput) {
  const blob = new Blob([buildReconciliationCsv(input)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = buildReconciliationFilename(input, "csv");
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function buildReconciliationHtml(input: ReconciliationExportInput): string {
  const { summary, breakdown, money } = input;
  const summaryRows: Array<[string, string]> = [
    ["Total project cost", money(summary.costTotal)],
    ["Total project funding", money(summary.fundingTotal)],
    ["Variance (cost − funding)", money(summary.variance)],
    ["Partner capital", money(summary.partnerCapital)],
    ["Partner loans", money(summary.partnerLoans)],
    ["Due to partners", money(summary.partnerPayables)],
    ["Company funding", money(summary.companyFunded)],
    ["Outstanding vendor payables", money(summary.outstandingVendor)],
  ];

  const sectionHtml = sections(breakdown)
    .map(
      (s) => `
      <h2>${html(s.title)}</h2>
      <table>
        <thead><tr><th>Item</th><th>Detail</th><th>Date</th><th class="r">Amount</th></tr></thead>
        <tbody>
          ${
            s.legs
              .map(
                (l) => `<tr class="${l.informational ? "muted" : ""}">
                  <td>${html(l.label)}${l.informational ? " <em>(not counted)</em>" : ""}</td>
                  <td>${html(l.detail ?? "")}</td>
                  <td>${html(l.date ?? "—")}</td>
                  <td class="r">${html(money(l.amount))}</td>
                </tr>`,
              )
              .join("") || `<tr><td colspan="4" class="muted">No items.</td></tr>`
          }
          ${
            typeof s.total === "number"
              ? `<tr class="total"><td colspan="3">Total</td><td class="r">${html(money(s.total))}</td></tr>`
              : ""
          }
        </tbody>
      </table>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8" />
<title>${html(buildReconciliationFilename(input, "pdf").replace(/\.pdf$/, ""))}</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; padding: 24px; color: #111; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  h2 { font-size: 14px; margin: 22px 0 6px; }
  p.meta { color: #666; font-size: 12px; margin: 0 0 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { background: #f5f5f5; border: 1px solid #ddd; padding: 8px; text-align: left; }
  td { border: 1px solid #ddd; padding: 6px 8px; }
  .r { text-align: right; }
  .muted { color: #777; }
  .total td { font-weight: 600; background: #fafafa; }
  .status { margin: 12px 0; padding: 10px; border: 1px solid #ddd; border-radius: 6px; font-size: 12px; }
  .ok { border-color: #00A859; background: rgba(0,168,89,.06); }
  .bad { border-color: #c0392b; background: rgba(192,57,43,.06); }
  @media print { body { padding: 0; } }
</style></head>
<body>
  <h1>Project cost vs funding reconciliation</h1>
  <p class="meta">${html(input.projectName)}${input.projectCode ? ` · ${html(input.projectCode)}` : ""} · generated ${html(
    format(new Date(), "PPP 'at' p"),
  )}</p>
  <div class="status ${summary.balanced ? "ok" : "bad"}">
    ${
      summary.balanced
        ? "Reconciled — project cost matches funding sources."
        : `Not reconciled — variance ${html(money(Math.abs(summary.variance)))}.`
    }
  </div>
  <h2>Summary</h2>
  <table><tbody>
    ${summaryRows.map(([k, v]) => `<tr><td>${html(k)}</td><td class="r">${html(v)}</td></tr>`).join("")}
  </tbody></table>
  ${sectionHtml}
  <script>window.onload = function () { window.print(); };</script>
</body></html>`;
}

export function printReconciliationPdf(input: ReconciliationExportInput) {
  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.write(buildReconciliationHtml(input));
  w.document.close();
  return true;
}
