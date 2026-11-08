/** CSV + PDF exports for the project partner funding reconciliation. */

const BRAND: [number, number, number] = [0, 168, 89];
const MUTED: [number, number, number] = [110, 118, 128];

const num = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export interface PartnerFundingExportRow {
  partnerName: string;
  ownershipPct: number;
  capital: number;
  loan: number;
  payable: number;
  totalFunded: number;
  expected: number;
  variance: number;
  repayable: number;
  unclassified: number;
}

export interface PartnerFundingExportArgs {
  projectName: string;
  restaurantName?: string;
  currencyLabel: string;
  rows: PartnerFundingExportRow[];
  summary: {
    partnerCapital: number;
    partnerLoans: number;
    partnerPayables: number;
    companyFunded: number;
    fundingTotal: number;
    costTotal: number;
    difference: number;
    balanced: boolean;
    totalInvestment: number;
  };
  fileName: string;
}

const totalsOf = (rows: PartnerFundingExportRow[]) =>
  rows.reduce(
    (a, r) => ({
      capital: a.capital + r.capital,
      loan: a.loan + r.loan,
      payable: a.payable + r.payable,
      totalFunded: a.totalFunded + r.totalFunded,
      expected: a.expected + r.expected,
      variance: a.variance + r.variance,
      repayable: a.repayable + r.repayable,
      unclassified: a.unclassified + r.unclassified,
      ownershipPct: a.ownershipPct + r.ownershipPct,
    }),
    {
      capital: 0,
      loan: 0,
      payable: 0,
      totalFunded: 0,
      expected: 0,
      variance: 0,
      repayable: 0,
      unclassified: 0,
      ownershipPct: 0,
    },
  );

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Downloads the reconciliation exactly as shown on screen as a CSV file. */
export function exportPartnerFundingCsv(args: PartnerFundingExportArgs) {
  const t = totalsOf(args.rows);
  const lines: (string | number)[][] = [
    ["Partner funding reconciliation"],
    ["Project", args.projectName],
    ["Generated", new Date().toISOString()],
    ["Currency", args.currencyLabel],
    [],
    [
      "Partner",
      "Ownership %",
      "Capital",
      "Loan",
      "Payable",
      "Total funded",
      "Expected share",
      "Over / (under)",
      "Repayable (remaining balance)",
      "Unclassified",
    ],
    ...args.rows.map((r) => [
      r.partnerName,
      r.ownershipPct.toFixed(2),
      r.capital.toFixed(2),
      r.loan.toFixed(2),
      r.payable.toFixed(2),
      r.totalFunded.toFixed(2),
      r.expected.toFixed(2),
      r.variance.toFixed(2),
      r.repayable.toFixed(2),
      r.unclassified.toFixed(2),
    ]),
    [
      "TOTAL",
      t.ownershipPct.toFixed(2),
      t.capital.toFixed(2),
      t.loan.toFixed(2),
      t.payable.toFixed(2),
      t.totalFunded.toFixed(2),
      t.expected.toFixed(2),
      t.variance.toFixed(2),
      t.repayable.toFixed(2),
      t.unclassified.toFixed(2),
    ],
    [],
    ["Summary"],
    ["Partner capital (equity)", args.summary.partnerCapital.toFixed(2)],
    ["Partner loans (liability)", args.summary.partnerLoans.toFixed(2)],
    ["Due to partners (payable)", args.summary.partnerPayables.toFixed(2)],
    ["Company funded", args.summary.companyFunded.toFixed(2)],
    [
      "Total repayable to partners",
      (args.summary.partnerLoans + args.summary.partnerPayables).toFixed(2),
    ],
    ["Total project investment", args.summary.totalInvestment.toFixed(2)],
    ["Total funding", args.summary.fundingTotal.toFixed(2)],
    ["Project cost", args.summary.costTotal.toFixed(2)],
    ["Difference", args.summary.difference.toFixed(2)],
    ["Reconciled", args.summary.balanced ? "Yes" : "No"],
  ];

  const csv = lines.map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${args.fileName}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

/** Renders a printable A4 landscape PDF summary with totals and remaining balances. */
export async function exportPartnerFundingPdf(args: PartnerFundingExportArgs) {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);

  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFillColor(...BRAND);
  doc.rect(0, 0, pageWidth, 54, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text("Partner Funding Reconciliation", 40, 24);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text([args.restaurantName, args.projectName].filter(Boolean).join("   |   "), 40, 40);
  doc.text(
    `Generated ${new Date().toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}`,
    pageWidth - 40,
    40,
    { align: "right" },
  );

  let y = 74;
  doc.setTextColor(30, 30, 30);
  doc.setFontSize(9);
  doc.text(`All amounts in ${args.currencyLabel}.`, 40, y);
  y += 12;

  const s = args.summary;
  autoTable(doc, {
    startY: y,
    head: [["Measure", "Amount"]],
    body: [
      ["Partner capital (equity)", num(s.partnerCapital)],
      ["Partner loans (liability)", num(s.partnerLoans)],
      ["Due to partners (payable)", num(s.partnerPayables)],
      ["Company funded", num(s.companyFunded)],
      ["Total repayable to partners", num(s.partnerLoans + s.partnerPayables)],
      ["Total project investment", num(s.totalInvestment)],
      ["Total funding", num(s.fundingTotal)],
      ["Project cost", num(s.costTotal)],
      ["Difference", num(s.difference)],
      ["Reconciled", s.balanced ? "Yes" : "No"],
    ],
    theme: "grid",
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: BRAND, textColor: 255, fontStyle: "bold" },
    columnStyles: { 1: { halign: "right" } },
    margin: { left: 40, right: 40, bottom: 40 },
    tableWidth: 320,
  });
  y = (doc as any).lastAutoTable.finalY + 18;

  const head = [
    "Partner",
    "Ownership %",
    "Capital",
    "Loan",
    "Payable",
    "Total funded",
    "Expected share",
    "Over / (under)",
    "Remaining repayable",
    "Unclassified",
  ];
  const t = totalsOf(args.rows);
  const body = args.rows.map((r) => [
    r.partnerName,
    r.ownershipPct.toFixed(2),
    num(r.capital),
    num(r.loan),
    num(r.payable),
    num(r.totalFunded),
    num(r.expected),
    num(r.variance),
    num(r.repayable),
    num(r.unclassified),
  ]);
  body.push([
    "TOTAL",
    t.ownershipPct.toFixed(2),
    num(t.capital),
    num(t.loan),
    num(t.payable),
    num(t.totalFunded),
    num(t.expected),
    num(t.variance),
    num(t.repayable),
    num(t.unclassified),
  ]);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("Funding by partner", 40, y);
  y += 6;
  autoTable(doc, {
    startY: y,
    head: [head],
    body: body.length
      ? body
      : [["No partners on this project.", ...Array(head.length - 1).fill("")]],
    theme: "striped",
    styles: { fontSize: 7.5, cellPadding: 3, overflow: "linebreak" },
    headStyles: { fillColor: BRAND, textColor: 255, fontStyle: "bold" },
    columnStyles: Object.fromEntries(
      head.map((_, i) => [i, i >= 1 ? { halign: "right" as const } : {}]),
    ),
    didParseCell: (data: any) => {
      if (data.section === "body" && data.row.index === body.length - 1) {
        data.cell.styles.fontStyle = "bold";
      }
    },
    margin: { left: 40, right: 40, bottom: 40 },
  });

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    const baseline = doc.internal.pageSize.getHeight() - 18;
    doc.text(
      `${args.restaurantName || "Matbex"} - Partner Funding Reconciliation - ${args.projectName}`,
      40,
      baseline,
    );
    doc.text(`Page ${i} of ${pages}`, pageWidth - 40, baseline, { align: "right" });
  }

  doc.save(`${args.fileName}.pdf`);
}
