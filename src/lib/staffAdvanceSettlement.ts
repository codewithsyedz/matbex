/**
 * Canonical settlement state for a staff advance.
 *
 * A single source of truth for "how much is still due" and "is this paid or
 * outstanding", used by the advances table, repayment dialog, payroll
 * deduction previews and reconciliation panels so every screen agrees.
 */

export const SETTLEMENT_TOLERANCE = 0.005;

export type AdvanceSettlementStatus =
  | "outstanding"
  | "partially_paid"
  | "paid"
  | "forgiven"
  | "reversed";

export interface AdvanceSettlementInput {
  amount: number;
  repaid_amount?: number | null;
  status?: string | null;
  ledger_reversed?: boolean | null;
}

export interface AdvanceSettlement {
  amount: number;
  repaid: number;
  /** Remaining due after repayments / payroll deduction / forgiveness. */
  outstanding: number;
  percentRepaid: number;
  status: AdvanceSettlementStatus;
  label: string;
  /** True when nothing is left to collect. */
  settled: boolean;
}

const round2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export function deriveAdvanceSettlement(advance: AdvanceSettlementInput): AdvanceSettlement {
  const amount = round2(Number(advance.amount) || 0);
  const rawRepaid = round2(Number(advance.repaid_amount) || 0);
  const repaid = Math.max(0, Math.min(amount, rawRepaid));

  let status: AdvanceSettlementStatus;
  let outstanding: number;

  if (advance.ledger_reversed) {
    status = "reversed";
    outstanding = 0;
  } else if (advance.status === "forgiven") {
    status = "forgiven";
    outstanding = 0;
  } else if (advance.status === "deducted") {
    status = "paid";
    outstanding = 0;
  } else {
    outstanding = round2(Math.max(0, amount - repaid));
    if (outstanding <= SETTLEMENT_TOLERANCE) {
      status = "paid";
      outstanding = 0;
    } else if (repaid > SETTLEMENT_TOLERANCE) {
      status = "partially_paid";
    } else {
      status = "outstanding";
    }
  }

  const percentRepaid =
    amount > 0 ? Math.min(100, Math.max(0, round2(((amount - outstanding) / amount) * 100))) : 0;

  return {
    amount,
    repaid,
    outstanding,
    percentRepaid,
    status,
    label: settlementLabel(status),
    settled: outstanding <= SETTLEMENT_TOLERANCE,
  };
}

export function settlementLabel(status: AdvanceSettlementStatus): string {
  switch (status) {
    case "paid":
      return "Paid";
    case "partially_paid":
      return "Partially paid";
    case "forgiven":
      return "Forgiven";
    case "reversed":
      return "Reversed";
    default:
      return "Outstanding";
  }
}

/** Tailwind classes for the status badge, kept in one place. */
export function settlementBadgeClass(status: AdvanceSettlementStatus): string {
  switch (status) {
    case "paid":
      return "text-green-600 border-green-300 bg-green-50";
    case "partially_paid":
      return "text-blue-600 border-blue-300 bg-blue-50";
    case "forgiven":
      return "text-purple-600 border-purple-300 bg-purple-50";
    case "reversed":
      return "text-muted-foreground border-border bg-muted";
    default:
      return "text-amber-600 border-amber-300 bg-amber-50";
  }
}

export interface AdvanceSettlementSummary {
  advanceTotal: number;
  repaidTotal: number;
  outstandingTotal: number;
  forgivenTotal: number;
  paidCount: number;
  partialCount: number;
  outstandingCount: number;
  forgivenCount: number;
  reversedCount: number;
  percentRepaid: number;
}

export function summarizeAdvanceSettlements(
  advances: AdvanceSettlementInput[]
): AdvanceSettlementSummary {
  const summary: AdvanceSettlementSummary = {
    advanceTotal: 0,
    repaidTotal: 0,
    outstandingTotal: 0,
    forgivenTotal: 0,
    paidCount: 0,
    partialCount: 0,
    outstandingCount: 0,
    forgivenCount: 0,
    reversedCount: 0,
    percentRepaid: 0,
  };

  for (const advance of advances) {
    const s = deriveAdvanceSettlement(advance);
    if (s.status === "reversed") {
      summary.reversedCount += 1;
      continue;
    }
    summary.advanceTotal += s.amount;
    summary.repaidTotal += s.repaid;
    summary.outstandingTotal += s.outstanding;
    if (s.status === "forgiven") {
      summary.forgivenTotal += round2(s.amount - s.repaid);
      summary.forgivenCount += 1;
    } else if (s.status === "paid") {
      summary.paidCount += 1;
    } else if (s.status === "partially_paid") {
      summary.partialCount += 1;
    } else {
      summary.outstandingCount += 1;
    }
  }

  summary.advanceTotal = round2(summary.advanceTotal);
  summary.repaidTotal = round2(summary.repaidTotal);
  summary.outstandingTotal = round2(summary.outstandingTotal);
  summary.forgivenTotal = round2(summary.forgivenTotal);
  summary.percentRepaid =
    summary.advanceTotal > 0
      ? round2(((summary.advanceTotal - summary.outstandingTotal) / summary.advanceTotal) * 100)
      : 0;

  return summary;
}
