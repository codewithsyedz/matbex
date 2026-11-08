/**
 * Branded PDF export of the Profit & Loss statement.
 * A4 portrait: header band, sectioned statement table (revenue, COGS, gross
 * profit, operating expenses, net income) and a per-page footer stamp.
 */
const BRAND: [number, number, number] = [0, 168, 89];
const MUTED: [number, number, number] = [110, 118, 128];
const BAND: [number, number, number] = [238, 245, 241];

export interface PlPdfLine {
  label: string;
  amount: number;
  /** Renders as a section heading row (no amount shown). */
  section?: boolean;
  /** Renders bold with a tinted background. */
  emphasis?: boolean;
  indent?: boolean;
  /** Shown in the "% of sales" column; computed from net sales when omitted. */
  percent?: number | null;
}

export interface ProfitLossPdfArgs {
  restaurantName: string;
  branchLabel?: string | null;
  periodLabel: string;
  currency: string;
  netSales: number;
  lines: PlPdfLine[];
  fileName: string;
}

/** jsPDF core fonts are WinAnsi-only: drop glyphs they cannot render (e.g. the Riyal sign). */
const ascii = (v: string) =>
  String(v ?? "")
    .replace(/[\u2192]/g, "->")
    .replace(/[^\n\x20-\xFF]/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();

const num = (n: number) =>
  Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export async function exportProfitLossPdf(args: ProfitLossPdfArgs): Promise<void> {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);

  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 40;

  doc.setFillColor(...BRAND);
  doc.rect(0, 0, pageWidth, 66, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("Profit & Loss Statement", margin, 28);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.text(ascii(args.restaurantName || "Restaurant"), margin, 44);
  doc.text(
    ascii(
      [args.branchLabel, args.periodLabel].filter(Boolean).join(" - ") || args.periodLabel,
    ),
    margin,
    57,
  );

  const pct = (l: PlPdfLine) => {
    if (l.section) return "";
    const value = l.percent ?? (args.netSales > 0 ? (l.amount / args.netSales) * 100 : null);
    return value == null || !Number.isFinite(value) ? "" : `${value.toFixed(1)}%`;
  };

  autoTable(doc, {
    startY: 88,
    margin: { left: margin, right: margin },
    head: [["Description", "% of sales", `Amount (${ascii(args.currency) || "SAR"})`]],
    body: args.lines.map((l) => [
      ascii(`${l.indent ? "    " : ""}${l.label}`),
      pct(l),
      l.section ? "" : num(l.amount),
    ]),
    styles: { fontSize: 9, cellPadding: 5 },
    headStyles: { fillColor: BRAND, textColor: 255, fontStyle: "bold" },
    columnStyles: {
      1: { halign: "right", cellWidth: 80 },
      2: { halign: "right", cellWidth: 110 },
    },
    didParseCell: (data) => {
      const line = args.lines[data.row.index];
      if (!line || data.section !== "body") return;
      if (line.section) {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fillColor = [245, 246, 247];
      }
      if (line.emphasis) {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fillColor = BAND;
      }
    },
  });

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i += 1) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text(
      ascii(`Generated ${new Date().toLocaleString("en-GB")}`),
      margin,
      pageHeight - 20,
    );
    doc.text(`Page ${i} / ${pages}`, pageWidth - margin, pageHeight - 20, { align: "right" });
  }

  doc.save(args.fileName);
}
