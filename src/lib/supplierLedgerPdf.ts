/**
 * PDF export of the Supplier Ledger report.
 * Landscape A4: summary band, per-supplier totals, then every posted debit /
 * credit line grouped under its expense.
 */
import type { SupplierLedgerEntry } from "@/hooks/useSupplierLedger";

const BRAND: [number, number, number] = [0, 168, 89];
const MUTED: [number, number, number] = [110, 118, 128];

export interface SupplierLedgerPdfRow {
  supplierId: string;
  supplierName: string;
  entries: number;
  postedEntries: number;
  billed: number;
  settled: number;
  open: number;
}

export interface SupplierLedgerPdfArgs {
  restaurantName: string;
  branchLabel: string;
  periodLabel: string;
  supplierLabel: string;
  payableHead?: string | null;
  rows: SupplierLedgerPdfRow[];
  entries: SupplierLedgerEntry[];
  totals: {
    billed: number;
    settled: number;
    open: number;
    entries: number;
    unposted: number;
    unbalanced: number;
  };
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

async function buildSupplierLedgerDoc(args: SupplierLedgerPdfArgs) {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);

  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 28;

  // Header band
  doc.setFillColor(...BRAND);
  doc.rect(0, 0, pageWidth, 64, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text("Supplier Ledger", margin, 27);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(ascii(args.restaurantName || "Restaurant"), margin, 42);
  doc.text(
    ascii(`${args.supplierLabel} - ${args.branchLabel} - ${args.periodLabel}`),
    margin,
    55,
  );

  let y = 84;
  doc.setTextColor(...MUTED);
  doc.setFontSize(8);
  if (args.payableHead) {
    doc.text(ascii(`Payable head: ${args.payableHead}`), margin, y);
    y += 12;
  }
  doc.text(
    ascii(
      `Billed ${num(args.totals.billed)} | Settled ${num(args.totals.settled)} | Open ${num(
        args.totals.open,
      )} | Entries ${args.totals.entries} | Unposted ${args.totals.unposted} | Unbalanced ${args.totals.unbalanced}`,
    ),
    margin,
    y,
  );
  y += 12;

  // By supplier
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [["Supplier", "Entries", "Posted", "Billed (CR)", "Settled (DR)", "Open"]],
    body: args.rows.map((r) => [
      ascii(r.supplierName),
      String(r.entries),
      `${r.postedEntries}/${r.entries}`,
      num(r.billed),
      num(r.settled),
      num(r.open),
    ]),
    foot: [
      [
        "Total",
        String(args.totals.entries),
        "",
        num(args.totals.billed),
        num(args.totals.settled),
        num(args.totals.open),
      ],
    ],
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: BRAND, textColor: 255, fontStyle: "bold" },
    footStyles: { fillColor: [245, 246, 247], textColor: 20, fontStyle: "bold" },
    columnStyles: {
      1: { halign: "right" },
      2: { halign: "right" },
      3: { halign: "right" },
      4: { halign: "right" },
      5: { halign: "right" },
    },
  });

  // Detail lines
  const body: Array<Array<string>> = [];
  for (const e of args.entries) {
    if (e.lines.length === 0) {
      body.push([
        ascii(e.supplierName),
        e.expenseDate,
        ascii(e.description),
        ascii(e.branchName ?? "Unassigned"),
        "",
        "NOT POSTED",
        "",
        "",
        "unposted",
      ]);
      continue;
    }
    for (const l of e.lines) {
      body.push([
        ascii(e.supplierName),
        e.expenseDate,
        ascii(e.description),
        ascii(e.branchName ?? "Unassigned"),
        l.date,
        ascii(`${l.accountCode} - ${l.accountName}`),
        l.debit ? num(l.debit) : "",
        l.credit ? num(l.credit) : "",
        l.isVoided ? "voided" : "posted",
      ]);
    }
  }

  const prevY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y;
  autoTable(doc, {
    startY: prevY + 18,
    margin: { left: margin, right: margin },
    head: [
      [
        "Supplier",
        "Expense date",
        "Description",
        "Branch",
        "Entry date",
        "Account",
        "Debit",
        "Credit",
        "Status",
      ],
    ],
    body,
    styles: { fontSize: 7.5, cellPadding: 3, overflow: "linebreak" },
    headStyles: { fillColor: BRAND, textColor: 255, fontStyle: "bold" },
    columnStyles: {
      2: { cellWidth: 150 },
      5: { cellWidth: 150 },
      6: { halign: "right" },
      7: { halign: "right" },
    },
  });

  // Footer stamp
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i += 1) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    doc.text(
      ascii(`Generated ${new Date().toLocaleString("en-GB")}`),
      margin,
      doc.internal.pageSize.getHeight() - 14,
    );
    doc.text(
      `Page ${i} / ${pages}`,
      pageWidth - margin,
      doc.internal.pageSize.getHeight() - 14,
      { align: "right" },
    );
  }

  return doc;
}

/** Download the report in the browser. */
export async function exportSupplierLedgerPdf(args: SupplierLedgerPdfArgs): Promise<void> {
  const doc = await buildSupplierLedgerDoc(args);
  doc.save(args.fileName);
}

/** Same document, returned as a base64 string (for emailing as an attachment). */
export async function renderSupplierLedgerPdfBase64(args: SupplierLedgerPdfArgs): Promise<string> {
  const doc = await buildSupplierLedgerDoc(args);
  return doc.output("datauristring").split(",")[1] ?? "";
}
