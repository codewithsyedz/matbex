/**
 * Mobile-friendly PDF export of the staff payable breakdown.
 * Renders on A5 portrait so it reads well on a phone screen when shared.
 */
const BRAND: [number, number, number] = [0, 168, 89];
const MUTED: [number, number, number] = [110, 118, 128];

export interface PayablePdfFineLine {
  label: string;
  amount: number;
  month: string;
  isOverdue: boolean;
}

export interface PayablePdfRow {
  name: string;
  role: string;
  branchName?: string | null;
  baseSalary: number;
  joiningArrears: number;
  pendingAdvances: number;
  pendingFines: number;
  netPayable: number;
  isPaid: boolean;
  isProrated: boolean;
  fineLines: PayablePdfFineLine[];
}

export interface PayablePdfArgs {
  restaurantName: string;
  branchLabel: string;
  periodLabel: string;
  periodNote?: string;
  recoveryBasisLabel: string;
  formatCurrency: (n: number) => string;
  rows: PayablePdfRow[];
  totals: {
    baseSalary: number;
    advances: number;
    fines: number;
    net: number;
    remaining: number;
    paidCount: number;
  };
  fileName: string;
  /** "save" downloads the file (default); "blob" returns it for sharing. */
  output?: "save" | "blob";
}

export async function exportStaffPayablePdf(args: PayablePdfArgs): Promise<Blob | void> {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);

  /** jsPDF core fonts are WinAnsi-only: drop glyphs they cannot render (e.g. the Riyal sign). */
  const ascii = (v: string) =>
    v.replace(/[\u2192]/g, "->").replace(/[^\n\x20-\xFF]/g, "").replace(/[ \t]+/g, " ");
  const money = (n: number) => ascii(args.formatCurrency(n));
  /** Bare numbers keep the narrow table columns readable on a phone. */
  const num = (n: number) =>
    n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a5" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 24;

  // ---- Header band -------------------------------------------------------
  doc.setFillColor(...BRAND);
  doc.rect(0, 0, pageWidth, 62, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("Payable Breakdown", margin, 26);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(ascii(args.restaurantName || "Restaurant"), margin, 40);
  doc.text(ascii(`${args.branchLabel} - ${args.periodLabel}`), margin, 52);

  doc.setTextColor(...MUTED);
  doc.setFontSize(8);
  let y = 78;
  if (args.periodNote) {
    doc.text(doc.splitTextToSize(ascii(args.periodNote), pageWidth - margin * 2), margin, y);
    y += 12;
  }
  doc.text(ascii(`Fine recovery basis: ${args.recoveryBasisLabel} | Amounts in ${money(0).replace(/[\d.,]/g, "").trim() || "local currency"}`), margin, y);
  y += 14;

  // ---- Totals summary ----------------------------------------------------
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    theme: "grid",
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: BRAND, textColor: 255, fontSize: 8 },
    head: [["Salaries", "Advances", "Fines", "Net payable"]],
    body: [
      [
        money(args.totals.baseSalary),
        `- ${money(args.totals.advances)}`,
        `- ${money(args.totals.fines)}`,
        money(args.totals.net),
      ],
    ],
  });

  y = (doc as any).lastAutoTable.finalY + 10;
  doc.setFontSize(9);
  doc.setTextColor(20, 20, 20);
  doc.setFont("helvetica", "bold");
  doc.text(`Remaining to pay: ${money(args.totals.remaining)}`, margin, y);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...MUTED);
  doc.setFontSize(8);
  doc.text(`${args.totals.paidCount}/${args.rows.length} staff already paid`, margin, y + 11);

  // ---- Staff rows --------------------------------------------------------
  const body = args.rows.map((r) => {
    const details: string[] = [];
    if (r.isProrated) details.push("pro-rated");
    if (r.joiningArrears > 0) details.push(`arrears ${num(r.joiningArrears)}`);
    for (const f of r.fineLines) {
      details.push(
        ascii(`${f.label} (${f.month}${f.isOverdue ? ", overdue" : ""}) ${num(f.amount)}`)
      );
    }
    const nameCell = [
      r.name,
      ascii(`${r.role}${r.branchName ? ` - ${r.branchName}` : ""}`),
      ...(details.length ? [details.join("\n")] : []),
    ].join("\n");
    return [
      ascii(nameCell),
      num(r.baseSalary + r.joiningArrears),
      r.pendingAdvances ? `-${num(r.pendingAdvances)}` : "-",
      r.pendingFines ? `-${num(r.pendingFines)}` : "-",
      `${num(r.netPayable)}${r.isPaid ? "\nPAID" : ""}`,
    ];
  });

  autoTable(doc, {
    startY: y + 20,
    margin: { left: margin, right: margin, bottom: 30 },
    theme: "striped",
    styles: { fontSize: 7.5, cellPadding: 4, overflow: "linebreak", valign: "top" },
    headStyles: { fillColor: BRAND, textColor: 255, fontSize: 7.5 },
    columnStyles: {
      0: { cellWidth: "auto" },
      1: { halign: "right", cellWidth: 48 },
      2: { halign: "right", cellWidth: 44, textColor: [180, 120, 0] },
      3: { halign: "right", cellWidth: 44, textColor: [190, 40, 40] },
      4: { halign: "right", cellWidth: 50, fontStyle: "bold" },
    },
    head: [["Staff", "Salary", "Adv.", "Fines", "Net"]],
    body,
    didDrawPage: () => {
      const h = doc.internal.pageSize.getHeight();
      doc.setFontSize(7);
      doc.setTextColor(...MUTED);
      doc.text(
        `Generated ${new Date().toLocaleString()} • Matbex`,
        margin,
        h - 14
      );
      doc.text(
        `Page ${doc.getNumberOfPages()}`,
        pageWidth - margin,
        h - 14,
        { align: "right" }
      );
    },
  });

  if (args.output === "blob") return doc.output("blob");
  doc.save(args.fileName);
}
