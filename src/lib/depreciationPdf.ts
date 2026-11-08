import type { DepreciationGroup, DepreciationReportRow, DepreciationTotals } from "@/hooks/useDepreciationReport";
import { drawPdfAuditStamp, type PdfAuditStamp } from "@/lib/pdfAuditStamp";

/** Matbex Emerald, used for the header band and table headers. */
const BRAND: [number, number, number] = [0, 168, 89];
const MUTED: [number, number, number] = [110, 118, 128];

const num = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const delta = (current: number, prior: number) => {
  const d = Math.round((current - prior) * 100) / 100;
  return `${d > 0 ? "+" : d < 0 ? "-" : ""}${num(Math.abs(d))}`;
};

export interface DepreciationPdfArgs {
  restaurantName: string;
  periodLabel: string;
  branchLabel: string;
  classLabel: string;
  compareLabel: string | null;
  currencyLabel: string;
  totals: DepreciationTotals;
  priorTotals: DepreciationTotals | null;
  byBranchClass: DepreciationGroup[];
  byClass: DepreciationGroup[];
  priorMatrix: Map<string, DepreciationGroup>;
  priorClass: Map<string, DepreciationGroup>;
  rows: DepreciationReportRow[];
  priorRowById: Map<string, DepreciationReportRow>;
  /** Traceability stamp rendered in the footer of every page. */
  auditStamp?: PdfAuditStamp;
  reconciliation?: {
    ledgerPeriodExpense: number;
    ledgerAccumulated: number;
    expenseVariance: number;
    accumulatedVariance: number;
    balanced: boolean;
  } | null;
  fileName: string;
  /** "save" downloads the file (default); "blob" returns it for upload/sharing. */
  output?: "save" | "blob";
}

/**
 * Renders the Asset Depreciation Report exactly as filtered on screen
 * (period, branch, asset class and comparison mode) into a paginated PDF.
 */
export async function exportDepreciationPdf(args: DepreciationPdfArgs): Promise<Blob | void> {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);

  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const comparing = !!args.compareLabel && !!args.priorTotals;

  // ---- Header band -------------------------------------------------------
  doc.setFillColor(...BRAND);
  doc.rect(0, 0, pageWidth, 54, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text("Asset Depreciation Report", 40, 24);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(
    [args.restaurantName, args.periodLabel, args.branchLabel, args.classLabel]
      .filter(Boolean)
      .join("   |   "),
    40,
    40,
  );
  doc.setTextColor(255, 255, 255);
  doc.text(
    `Generated ${new Date().toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}`,
    pageWidth - 40,
    40,
    { align: "right" },
  );
  if (comparing) {
    doc.text(`Compared with ${args.compareLabel}`, pageWidth - 40, 24, { align: "right" });
  }

  let y = 74;
  doc.setTextColor(30, 30, 30);
  doc.setFontSize(9);
  doc.text(`All amounts in ${args.currencyLabel}.`, 40, y);
  y += 12;

  // ---- Summary -----------------------------------------------------------
  const summaryHead = comparing
    ? [["Measure", "Current", args.compareLabel as string, "Variance"]]
    : [["Measure", "Amount"]];
  const summaryRow = (
    label: string,
    value: number,
    prior: number | undefined,
  ) =>
    comparing
      ? [label, num(value), num(prior ?? 0), delta(value, prior ?? 0)]
      : [label, num(value)];

  autoTable(doc, {
    startY: y,
    head: summaryHead,
    body: [
      summaryRow("Gross cost", args.totals.cost, args.priorTotals?.cost),
      summaryRow(
        "Opening accumulated depreciation",
        args.totals.openingAccumulated,
        args.priorTotals?.openingAccumulated,
      ),
      summaryRow(
        `Depreciation charge - ${args.periodLabel}`,
        args.totals.periodExpense,
        args.priorTotals?.periodExpense,
      ),
      summaryRow(
        "Closing accumulated depreciation",
        args.totals.closingAccumulated,
        args.priorTotals?.closingAccumulated,
      ),
      summaryRow("Net book value", args.totals.netBookValue, args.priorTotals?.netBookValue),
      comparing
        ? ["Assets on register", String(args.totals.assetCount), String(args.priorTotals?.assetCount ?? 0), ""]
        : ["Assets on register", String(args.totals.assetCount)],
    ],
    theme: "grid",
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: BRAND, textColor: 255, fontStyle: "bold" },
    columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" } },
    margin: { left: 40, right: 40, bottom: args.auditStamp ? 78 : 40 },
  });
  y = (doc as any).lastAutoTable.finalY + 18;

  // ---- Reconciliation ----------------------------------------------------
  if (args.reconciliation) {
    const r = args.reconciliation;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("Ledger reconciliation", 40, y);
    y += 6;
    autoTable(doc, {
      startY: y,
      head: [["Comparison", "Asset register", "General ledger", "Variance", "Status"]],
      body: [
        [
          `Depreciation charge - ${args.periodLabel}`,
          num(args.totals.periodExpense),
          num(r.ledgerPeriodExpense),
          delta(args.totals.periodExpense, r.ledgerPeriodExpense),
          Math.abs(r.expenseVariance) <= 0.05 ? "Match" : "Variance",
        ],
        [
          "Accumulated depreciation at period end",
          num(args.totals.closingAccumulated),
          num(r.ledgerAccumulated),
          delta(args.totals.closingAccumulated, r.ledgerAccumulated),
          Math.abs(r.accumulatedVariance) <= 0.05 ? "Match" : "Variance",
        ],
      ],
      theme: "grid",
      styles: { fontSize: 8, cellPadding: 4 },
      headStyles: { fillColor: BRAND, textColor: 255, fontStyle: "bold" },
      columnStyles: {
        1: { halign: "right" },
        2: { halign: "right" },
        3: { halign: "right" },
        4: { halign: "center" },
      },
      margin: { left: 40, right: 40, bottom: args.auditStamp ? 78 : 40 },
    });
    y = (doc as any).lastAutoTable.finalY + 18;
  }

  // ---- Branch x class breakdown -----------------------------------------
  const groupHead = [
    "Branch",
    "Asset class",
    "Assets",
    "Cost",
    "Opening accum.",
    "Period charge",
    ...(comparing ? [`Charge ${args.compareLabel}`, "Var charge"] : []),
    "Closing accum.",
    "Net book value",
    ...(comparing ? [`NBV ${args.compareLabel}`, "Var NBV"] : []),
  ];

  const groupBody = args.byBranchClass.map((g) => {
    const p = args.priorMatrix.get(g.key);
    return [
      g.sublabel ?? "",
      g.label,
      String(g.assetCount),
      num(g.cost),
      num(g.openingAccumulated),
      num(g.periodExpense),
      ...(comparing
        ? [num(p?.periodExpense ?? 0), delta(g.periodExpense, p?.periodExpense ?? 0)]
        : []),
      num(g.closingAccumulated),
      num(g.netBookValue),
      ...(comparing ? [num(p?.netBookValue ?? 0), delta(g.netBookValue, p?.netBookValue ?? 0)] : []),
    ];
  });

  groupBody.push([
    "TOTAL",
    "",
    String(args.totals.assetCount),
    num(args.totals.cost),
    num(args.totals.openingAccumulated),
    num(args.totals.periodExpense),
    ...(comparing
      ? [
          num(args.priorTotals?.periodExpense ?? 0),
          delta(args.totals.periodExpense, args.priorTotals?.periodExpense ?? 0),
        ]
      : []),
    num(args.totals.closingAccumulated),
    num(args.totals.netBookValue),
    ...(comparing
      ? [
          num(args.priorTotals?.netBookValue ?? 0),
          delta(args.totals.netBookValue, args.priorTotals?.netBookValue ?? 0),
        ]
      : []),
  ]);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("Breakdown by branch and asset class", 40, y);
  y += 6;
  autoTable(doc, {
    startY: y,
    head: [groupHead],
    body: groupBody,
    theme: "striped",
    styles: { fontSize: 7.5, cellPadding: 3, overflow: "linebreak" },
    headStyles: { fillColor: BRAND, textColor: 255, fontStyle: "bold" },
    columnStyles: Object.fromEntries(
      groupHead.map((_, i) => [i, i >= 2 ? { halign: "right" as const } : {}]),
    ),
    didParseCell: (data: any) => {
      if (data.section === "body" && data.row.index === groupBody.length - 1) {
        data.cell.styles.fontStyle = "bold";
      }
    },
    margin: { left: 40, right: 40, bottom: args.auditStamp ? 78 : 40 },
  });
  y = (doc as any).lastAutoTable.finalY + 18;

  // ---- Asset detail ------------------------------------------------------
  const detailHead = [
    "Asset",
    "Tag",
    "Branch",
    "Class",
    "Method",
    "In service",
    "Cost",
    "Opening accum.",
    "Period charge",
    "Closing accum.",
    "Net book value",
    ...(comparing ? [`NBV ${args.compareLabel}`, "Var NBV"] : []),
  ];

  const detailBody = args.rows.map((r) => {
    const p = args.priorRowById.get(r.assetId);
    return [
      r.name,
      r.assetTag ?? "-",
      r.branchName,
      r.className,
      r.method === "reducing_balance" ? "Reducing balance" : "Straight line",
      r.inServiceDate,
      num(r.cost),
      num(r.openingAccumulated),
      num(r.periodExpense),
      num(r.closingAccumulated),
      num(r.netBookValue),
      ...(comparing ? [num(p?.netBookValue ?? 0), delta(r.netBookValue, p?.netBookValue ?? 0)] : []),
    ];
  });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("Asset detail", 40, y);
  y += 6;
  autoTable(doc, {
    startY: y,
    head: [detailHead],
    body: detailBody.length
      ? detailBody
      : [["No assets on the register for the selected filters.", ...Array(detailHead.length - 1).fill("")]],
    theme: "striped",
    styles: { fontSize: 7, cellPadding: 3, overflow: "linebreak" },
    headStyles: { fillColor: BRAND, textColor: 255, fontStyle: "bold" },
    columnStyles: Object.fromEntries(
      detailHead.map((_, i) => [i, i >= 6 ? { halign: "right" as const } : {}]),
    ),
    margin: { left: 40, right: 40, bottom: args.auditStamp ? 78 : 40 },
  });

  // ---- Audit stamp + footer ---------------------------------------------
  const stampHeight = args.auditStamp ? drawPdfAuditStamp(doc, args.auditStamp) : 0;
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    const baseline = doc.internal.pageSize.getHeight() - 18 - stampHeight;
    doc.text(
      `${args.restaurantName || "Matbex"} - Asset Depreciation Report - ${args.periodLabel}`,
      40,
      baseline,
    );
    doc.text(`Page ${i} of ${pages}`, pageWidth - 40, baseline, {
      align: "right",
    });
  }

  if (args.output === "blob") {
    return doc.output("blob") as Blob;
  }
  doc.save(args.fileName);
}
