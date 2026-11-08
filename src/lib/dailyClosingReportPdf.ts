import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

import {
  CLOSING_REPORT_HEADERS,
  closingReportToRows,
  type ClosingReportRow,
  type ClosingReportTotals,
} from "@/lib/dailyClosingReport";
import { drawPdfAuditStamp, type PdfAuditStamp } from "@/lib/pdfAuditStamp";

export function exportClosingReportPdf(
  rows: ClosingReportRow[],
  totals: ClosingReportTotals,
  meta: {
    restaurantName: string;
    branchLabel: string;
    dateRange: string;
    currency: string;
    filename: string;
    /** Traceability stamp rendered in the footer of every page. */
    auditStamp?: PdfAuditStamp;
  },
) {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const width = doc.internal.pageSize.getWidth();

  doc.setFontSize(15);
  doc.text("Daily Closing Report", 40, 40);
  doc.setFontSize(10);
  doc.setTextColor(110);
  doc.text(meta.restaurantName, 40, 58);
  doc.text(`Branch: ${meta.branchLabel}`, 40, 72);
  doc.text(`Period: ${meta.dateRange}`, 40, 86);
  doc.text(`Generated: ${new Date().toLocaleString()}`, width - 40, 58, { align: "right" });
  doc.text(`Amounts in ${meta.currency}`, width - 40, 72, { align: "right" });
  doc.setTextColor(0);

  // Summary band
  autoTable(doc, {
    startY: 100,
    theme: "plain",
    styles: { fontSize: 9, cellPadding: 4 },
    head: [["Gross (incl. VAT)", "Net", "VAT", "Cash", "Card", "Adjustments", "Delta"]],
    body: [
      [
        totals.gross.toFixed(2),
        totals.net.toFixed(2),
        totals.vat.toFixed(2),
        totals.cash.toFixed(2),
        totals.card.toFixed(2),
        totals.adjustments.toFixed(2),
        totals.delta.toFixed(2),
      ],
    ],
    headStyles: { fontStyle: "bold", textColor: 90, fillColor: [245, 245, 245] },
  });

  const afterSummary = (doc as any).lastAutoTable?.finalY ?? 130;

  autoTable(doc, {
    startY: afterSummary + 16,
    head: [CLOSING_REPORT_HEADERS as unknown as string[]],
    body: closingReportToRows(rows).map((r) => r.map(String)),
    foot: [
      [
        "TOTAL",
        "",
        String(totals.txCount),
        totals.net.toFixed(2),
        totals.vat.toFixed(2),
        totals.gross.toFixed(2),
        totals.cash.toFixed(2),
        totals.card.toFixed(2),
        totals.delivery.toFixed(2),
        totals.other.toFixed(2),
        totals.adjustments.toFixed(2),
        totals.declared.toFixed(2),
        "",
        totals.delta.toFixed(2),
        "",
      ],
    ],
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [0, 168, 89], textColor: 255, fontStyle: "bold" },
    footStyles: { fillColor: [240, 240, 240], textColor: 20, fontStyle: "bold" },
    columnStyles: {
      2: { halign: "right" },
      3: { halign: "right" },
      4: { halign: "right" },
      5: { halign: "right" },
      6: { halign: "right" },
      7: { halign: "right" },
      8: { halign: "right" },
      9: { halign: "right" },
      10: { halign: "right" },
      11: { halign: "right" },
      12: { halign: "right" },
      13: { halign: "right" },
    },
    margin: { bottom: meta.auditStamp ? 78 : 40 },
  });

  if (meta.auditStamp) drawPdfAuditStamp(doc, meta.auditStamp);

  doc.save(meta.filename);
}