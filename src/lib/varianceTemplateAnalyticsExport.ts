import { format } from "date-fns";

export interface AnalyticsExportRow {
  template_label: string;
  template_kind: "builtin" | "custom";
  reason_label?: string | null;
  use_count: number;
  short_count: number;
  over_count: number;
  median_abs_variance: number;
  avg_variance: number;
  min_variance: number;
  max_variance: number;
  last_used_at: string | null;
}

export interface AnalyticsExportMeta {
  rangeLabel: string;
  restaurantName?: string;
  currencyFormatter: (n: number) => string;
}

function csvEscape(value: string | number | null | undefined): string {
  if (value == null) return "";
  const s = String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

export function exportAnalyticsCsv(rows: AnalyticsExportRow[], meta: AnalyticsExportMeta) {
  const headers = [
    "Template",
    "Type",
    "Linked reason",
    "Uses",
    "Shortages",
    "Overages",
    "Median |variance|",
    "Avg variance",
    "Min variance",
    "Max variance",
    "Last used",
  ];
  const lines: string[] = [];
  lines.push(`# Variance template analytics`);
  lines.push(`# Range: ${meta.rangeLabel}`);
  if (meta.restaurantName) lines.push(`# Restaurant: ${meta.restaurantName}`);
  lines.push(`# Generated: ${format(new Date(), "yyyy-MM-dd HH:mm")}`);
  lines.push(headers.map(csvEscape).join(","));

  for (const r of rows) {
    lines.push(
      [
        r.template_label,
        r.template_kind,
        r.reason_label ?? "",
        r.use_count,
        r.short_count,
        r.over_count,
        r.median_abs_variance.toFixed(2),
        r.avg_variance.toFixed(2),
        r.min_variance.toFixed(2),
        r.max_variance.toFixed(2),
        r.last_used_at ? format(new Date(r.last_used_at), "yyyy-MM-dd HH:mm") : "",
      ]
        .map(csvEscape)
        .join(",")
    );
  }

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  downloadBlob(blob, `variance-template-analytics-${format(new Date(), "yyyyMMdd-HHmm")}.csv`);
}

export function exportAnalyticsPdf(rows: AnalyticsExportRow[], meta: AnalyticsExportMeta) {
  const fmt = meta.currencyFormatter;
  const totalUses = rows.reduce((s, r) => s + r.use_count, 0);
  const totalShort = rows.reduce((s, r) => s + r.short_count, 0);
  const totalOver = rows.reduce((s, r) => s + r.over_count, 0);

  const tableRows = rows
    .map(
      (r) => `
    <tr>
      <td>
        <div class="t-label">${escapeHtml(r.template_label)}</div>
        <div class="t-meta">${r.template_kind === "builtin" ? "Built-in" : "Custom"}${
          r.reason_label ? ` &middot; ${escapeHtml(r.reason_label)}` : ""
        }</div>
      </td>
      <td class="num">${r.use_count}</td>
      <td class="num neg">${r.short_count}</td>
      <td class="num pos">${r.over_count}</td>
      <td class="num">${fmt(r.median_abs_variance)}</td>
      <td class="num">${fmt(r.avg_variance)}</td>
      <td class="num">${fmt(r.min_variance)} → ${fmt(r.max_variance)}</td>
      <td class="muted">${
        r.last_used_at ? format(new Date(r.last_used_at), "PP") : "-"
      }</td>
    </tr>`
    )
    .join("");

  const html = `<!doctype html>
<html><head><meta charset="utf-8"/>
<title>Variance Template Analytics</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #111; padding: 24px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .muted { color: #666; font-size: 11px; }
  .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 16px 0; }
  .card { border: 1px solid #e5e7eb; border-radius: 6px; padding: 8px 10px; }
  .card .label { font-size: 10px; color: #666; text-transform: uppercase; letter-spacing: .04em; }
  .card .value { font-size: 16px; font-weight: 600; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; margin-top: 8px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #eee; vertical-align: top; }
  th { font-size: 10px; text-transform: uppercase; letter-spacing: .04em; color: #555; background: #fafafa; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.neg { color: #b91c1c; }
  td.pos { color: #047857; }
  .t-label { font-weight: 500; }
  .t-meta { color: #777; font-size: 10px; margin-top: 2px; }
  @media print { body { padding: 12px; } }
</style></head>
<body>
  <h1>${escapeHtml(meta.restaurantName || "Variance Template Analytics")}</h1>
  <div class="muted">Range: ${escapeHtml(meta.rangeLabel)} &middot; Generated ${format(
    new Date(),
    "PPP 'at' p"
  )}</div>

  <div class="summary">
    <div class="card"><div class="label">Templates</div><div class="value">${rows.length}</div></div>
    <div class="card"><div class="label">Total selections</div><div class="value">${totalUses}</div></div>
    <div class="card"><div class="label">Shortages</div><div class="value" style="color:#b91c1c">${totalShort}</div></div>
    <div class="card"><div class="label">Overages</div><div class="value" style="color:#047857">${totalOver}</div></div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Template</th>
        <th class="num">Uses</th>
        <th class="num">Short</th>
        <th class="num">Over</th>
        <th class="num">Median |var|</th>
        <th class="num">Avg var</th>
        <th class="num">Range</th>
        <th>Last used</th>
      </tr>
    </thead>
    <tbody>${tableRows || `<tr><td colspan="8" class="muted">No data in this range.</td></tr>`}</tbody>
  </table>

  <script>window.print();</script>
</body></html>`;

  const w = window.open("", "_blank");
  if (w) {
    w.document.write(html);
    w.document.close();
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
