/**
 * Downloadable receipts (CSV / PDF) for staff advance repayments.
 *
 * A receipt shows the repayment amount, its funding source (payroll, cash or
 * bank), the advance it settles, and the exact ledger references (transaction
 * id, batch and DR/CR legs) so it can be tied back to the general ledger.
 */

export interface ReceiptLedgerLeg {
  id: string;
  account_code?: string | null;
  account_name?: string | null;
  debit?: number | null;
  credit?: number | null;
  batch_id?: string | null;
  transaction_date?: string | null;
  is_voided?: boolean | null;
}

export interface ReceiptRepayment {
  id: string;
  amount: number | null;
  repayment_date: string;
  source?: string | null;
  notes?: string | null;
  created_at?: string | null;
  ledger_transaction_id?: string | null;
}

export interface ReceiptContext {
  restaurantName?: string | null;
  branchLabel?: string | null;
  staffName?: string | null;
  advanceId: string;
  advanceAmount: number;
  advanceDate?: string | null;
  outstandingAfter: number;
  currency: string;
}

export interface RepaymentReceipt {
  receiptNo: string;
  repayment: ReceiptRepayment;
  context: ReceiptContext;
  legs: ReceiptLedgerLeg[];
  sourceLabel: string;
  ledgerReference: string;
  batchReference: string;
  amount: number;
}

export function repaymentSourceLabel(source?: string | null): string {
  switch ((source ?? "").toLowerCase()) {
    case "cash":
      return "Cash in hand";
    case "bank":
      return "Bank transfer";
    case "payroll":
      return "Payroll deduction";
    default:
      return source ? source : "Repayment";
  }
}

export function receiptNumber(repayment: ReceiptRepayment): string {
  const d = (repayment.repayment_date ?? "").replace(/-/g, "");
  return `ADV-RCP-${d}-${repayment.id.slice(0, 8).toUpperCase()}`;
}

/** Pick the journal legs that belong to one repayment (same transaction or batch). */
export function legsForRepayment(
  repayment: ReceiptRepayment,
  allLegs: ReceiptLedgerLeg[],
): ReceiptLedgerLeg[] {
  if (!repayment.ledger_transaction_id) return [];
  const primary = allLegs.find((l) => l.id === repayment.ledger_transaction_id);
  if (!primary) return [];
  if (primary.batch_id) return allLegs.filter((l) => l.batch_id === primary.batch_id);
  return [primary];
}

export function buildRepaymentReceipt(
  repayment: ReceiptRepayment,
  context: ReceiptContext,
  allLegs: ReceiptLedgerLeg[] = [],
): RepaymentReceipt {
  const legs = legsForRepayment(repayment, allLegs);
  return {
    receiptNo: receiptNumber(repayment),
    repayment,
    context,
    legs,
    amount: Number(repayment.amount) || 0,
    sourceLabel: repaymentSourceLabel(repayment.source),
    ledgerReference: repayment.ledger_transaction_id
      ? repayment.ledger_transaction_id
      : "Not posted separately (settled through payroll journal)",
    batchReference: legs.find((l) => l.batch_id)?.batch_id ?? "—",
  };
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function repaymentReceiptCsv(receipt: RepaymentReceipt): string {
  const { context: c, repayment: r } = receipt;
  const lines: string[][] = [
    ["Staff advance repayment receipt"],
    ["Receipt no", receipt.receiptNo],
    ["Restaurant", c.restaurantName ?? ""],
    ["Branch", c.branchLabel ?? ""],
    ["Employee", c.staffName ?? ""],
    ["Advance id", c.advanceId],
    ["Advance date", c.advanceDate ?? ""],
    ["Advance amount", c.advanceAmount.toFixed(2)],
    [],
    ["Repayment date", r.repayment_date],
    ["Amount", receipt.amount.toFixed(2)],
    ["Currency", c.currency],
    ["Source", receipt.sourceLabel],
    ["Notes", r.notes ?? ""],
    ["Outstanding after", c.outstandingAfter.toFixed(2)],
    [],
    ["Ledger transaction", receipt.ledgerReference],
    ["Batch", receipt.batchReference],
    [],
    ["Account code", "Account name", "Debit", "Credit", "Date", "Status"],
  ];
  for (const leg of receipt.legs) {
    lines.push([
      leg.account_code ?? "",
      leg.account_name ?? "",
      Number(leg.debit || 0).toFixed(2),
      Number(leg.credit || 0).toFixed(2),
      leg.transaction_date ?? "",
      leg.is_voided ? "Voided" : "Active",
    ]);
  }
  if (!receipt.legs.length) {
    lines.push(["—", "No separate journal (payroll posting credits 1150)", "0.00", "0.00", "", ""]);
  }
  return lines.map((row) => row.map(csvCell).join(",")).join("\n");
}

export function downloadReceiptCsv(receipt: RepaymentReceipt) {
  const blob = new Blob([repaymentReceiptCsv(receipt)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${receipt.receiptNo}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function downloadReceiptPdf(receipt: RepaymentReceipt) {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const { context: c, repayment: r } = receipt;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const width = doc.internal.pageSize.getWidth();

  doc.setFontSize(15);
  doc.text("Staff Advance Repayment Receipt", 40, 46);
  doc.setFontSize(10);
  doc.setTextColor(110);
  if (c.restaurantName) doc.text(c.restaurantName, 40, 64);
  if (c.branchLabel) doc.text(`Branch: ${c.branchLabel}`, 40, 78);
  doc.text(`Receipt no: ${receipt.receiptNo}`, width - 40, 64, { align: "right" });
  doc.text(`Issued: ${new Date().toLocaleString()}`, width - 40, 78, { align: "right" });
  doc.setTextColor(0);

  autoTable(doc, {
    startY: 96,
    theme: "grid",
    styles: { fontSize: 9, cellPadding: 5 },
    head: [["Detail", "Value"]],
    headStyles: { fillColor: [0, 168, 89] },
    body: [
      ["Employee", c.staffName ?? "—"],
      ["Advance date", c.advanceDate ?? "—"],
      ["Advance amount", `${c.currency} ${c.advanceAmount.toFixed(2)}`],
      ["Repayment date", r.repayment_date],
      ["Amount received", `${c.currency} ${receipt.amount.toFixed(2)}`],
      ["Source", receipt.sourceLabel],
      ["Notes", r.notes ?? "—"],
      ["Outstanding after", `${c.currency} ${c.outstandingAfter.toFixed(2)}`],
      ["Ledger transaction", receipt.ledgerReference],
      ["Batch", receipt.batchReference],
    ],
  });

  const afterY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 300;
  doc.setFontSize(11);
  doc.text("Ledger references", 40, afterY + 26);

  autoTable(doc, {
    startY: afterY + 36,
    theme: "striped",
    styles: { fontSize: 9, cellPadding: 4 },
    head: [["Account", "Debit", "Credit", "Date", "Status"]],
    headStyles: { fillColor: [240, 240, 240], textColor: 60 },
    body: receipt.legs.length
      ? receipt.legs.map((leg) => [
          `${leg.account_code ?? ""} ${leg.account_name ?? ""}`.trim(),
          Number(leg.debit || 0) ? Number(leg.debit).toFixed(2) : "—",
          Number(leg.credit || 0) ? Number(leg.credit).toFixed(2) : "—",
          leg.transaction_date ?? "—",
          leg.is_voided ? "Voided" : "Active",
        ])
      : [["No separate journal — payroll posting credits 1150", "—", "—", "—", "—"]],
  });

  doc.save(`${receipt.receiptNo}.pdf`);
}
