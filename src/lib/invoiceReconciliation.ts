/**
 * Pure reconciliation rules shared by the Invoice Ledger Reconciliation report.
 *
 * Two regressions are guarded here by design:
 *  - VAT-only false alerts: line items are compared against the invoice
 *    *subtotal* (net of tax), never the gross total.
 *  - Duplicate-repair false positives: identical lines only count as duplicates
 *    when they share the exact same creation timestamp (a systemic rewrite),
 *    not when the same item was legitimately purchased twice.
 */

export type InvoiceReconIssue =
  | "ok"
  | "duplicate_lines"
  | "total_mismatch"
  | "expense_mismatch"
  | "ledger_mismatch"
  | "not_posted";

export const INVOICE_RECON_ISSUE_LABELS: Record<InvoiceReconIssue, string> = {
  ok: "Reconciled",
  duplicate_lines: "Duplicated lines",
  total_mismatch: "Total ≠ lines",
  expense_mismatch: "Expense ≠ bill",
  ledger_mismatch: "Ledger ≠ bill",
  not_posted: "Not posted to ledger",
};

export const ISSUE_RANK: InvoiceReconIssue[] = [
  "duplicate_lines",
  "ledger_mismatch",
  "expense_mismatch",
  "total_mismatch",
  "not_posted",
  "ok",
];

export interface InvoiceLineGroup {
  signature: string;
  description: string;
  quantity: number;
  unitPrice: number;
  linePrice: number;
  count: number;
  duplicateAmount: number;
  suspectedDuplicate: boolean;
  creationTimestamp: number | null;
}

export interface ReconLineInput {
  description?: string | null;
  quantity?: number | string | null;
  unit_price?: number | string | null;
  total_price?: number | string | null;
  created_at?: string | null;
}

export interface ReconInvoiceInput {
  total_amount?: number | string | null;
  subtotal?: number | string | null;
  tax_amount?: number | string | null;
}

export interface ReconEvaluation {
  invoiceTotal: number;
  invoiceSubtotal: number;
  itemsSum: number;
  dedupSum: number;
  duplicateAmount: number;
  lineCount: number;
  duplicateLineCount: number;
  groups: InvoiceLineGroup[];
  issues: InvoiceReconIssue[];
  worstIssue: InvoiceReconIssue;
}

export const round2 = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100;
export const differs = (a: number, b: number) => Math.abs(round2(a) - round2(b)) > 0.01;

/** Groups identical lines and marks only same-timestamp repeats as duplicates. */
export function buildLineGroups(lines: ReconLineInput[]): InvoiceLineGroup[] {
  const groupsMap = new Map<string, InvoiceLineGroup>();
  for (const l of lines) {
    const qty = Number(l.quantity) || 0;
    const unit = Number(l.unit_price) || 0;
    const price = Number(l.total_price) || 0;
    const signature = `${l.description ?? ""}|${qty}|${unit}|${price}`;
    const event = new Date(l.created_at ?? "").getTime();
    const g = groupsMap.get(signature);
    if (g) {
      g.count += 1;
      if (Number.isNaN(event) || event !== g.creationTimestamp) {
        g.suspectedDuplicate = false;
        g.duplicateAmount = 0;
      } else if (g.suspectedDuplicate) {
        g.duplicateAmount = round2(g.linePrice * (g.count - 1));
      }
    } else {
      groupsMap.set(signature, {
        signature,
        description: l.description ?? "(no description)",
        quantity: qty,
        unitPrice: unit,
        linePrice: price,
        count: 1,
        duplicateAmount: 0,
        suspectedDuplicate: !Number.isNaN(event),
        creationTimestamp: Number.isNaN(event) ? null : event,
      });
    }
  }
  return Array.from(groupsMap.values()).sort((a, b) => b.count - a.count);
}

export const isSuspectedDuplicate = (g: InvoiceLineGroup) => g.count > 1 && g.suspectedDuplicate;

/**
 * Evaluates one invoice against its lines, linked expense and ledger legs.
 * Lines are compared to the subtotal so VAT never produces a false alert.
 */
export function evaluateInvoiceReconciliation(input: {
  invoice: ReconInvoiceInput;
  lines: ReconLineInput[];
  expenseAmount?: number | null;
  hasExpense?: boolean;
  ledgerDebit?: number | null;
  ledgerLegCount?: number;
}): ReconEvaluation {
  const { invoice, lines } = input;
  const groups = buildLineGroups(lines);
  const itemsSum = round2(lines.reduce((s, l) => s + (Number(l.total_price) || 0), 0));
  const dedupSum = round2(
    groups.reduce((s, g) => s + g.linePrice * (isSuspectedDuplicate(g) ? 1 : g.count), 0),
  );
  const duplicateAmount = round2(itemsSum - dedupSum);
  const duplicateLineCount = groups.reduce(
    (s, g) => s + (isSuspectedDuplicate(g) ? g.count - 1 : 0),
    0,
  );

  const invoiceTotal = round2(invoice.total_amount);
  const invoiceSubtotal = round2(
    invoice.subtotal ?? invoiceTotal - (Number(invoice.tax_amount) || 0),
  );

  const expenseAmount = input.expenseAmount == null ? null : round2(input.expenseAmount);
  const hasExpense = input.hasExpense ?? expenseAmount != null;
  const legs = input.ledgerLegCount ?? 0;
  const ledgerAmount = input.ledgerDebit == null ? null : round2(input.ledgerDebit);

  const issues: InvoiceReconIssue[] = [];
  if (duplicateLineCount > 0) issues.push("duplicate_lines");
  if (lines.length > 0 && differs(invoiceSubtotal, itemsSum)) issues.push("total_mismatch");
  if (expenseAmount != null && differs(expenseAmount, invoiceTotal)) issues.push("expense_mismatch");
  if (hasExpense && legs === 0) issues.push("not_posted");
  else if (ledgerAmount != null && differs(ledgerAmount, invoiceTotal)) issues.push("ledger_mismatch");

  return {
    invoiceTotal,
    invoiceSubtotal,
    itemsSum,
    dedupSum,
    duplicateAmount,
    lineCount: lines.length,
    duplicateLineCount,
    groups,
    issues,
    worstIssue: ISSUE_RANK.find((i) => issues.includes(i)) ?? "ok",
  };
}