/**
 * Reconciles the staff advances list against what was actually posted to the
 * general ledger (Employee Advances Receivable, account 1150).
 *
 * Source side  : advances that are posted and not reversed.
 * Ledger side  : net DR on 1150 for reference types staff_advance /
 *                staff_advance_reversal, excluding voided legs.
 */

export const ADVANCE_RECEIVABLE_CODES = ["1150"];
export const RECONCILIATION_TOLERANCE = 0.02;

export interface AdvanceSourceRow {
  id: string;
  amount: number;
  ledger_posted?: boolean | null;
  ledger_reversed?: boolean | null;
  status?: string | null;
  repaid_amount?: number | null;
  staff_name?: string | null;
}

export interface AdvanceLedgerLeg {
  reference_id: string | null;
  debit?: number | null;
  credit?: number | null;
  is_voided?: boolean | null;
  account_code?: string | null;
  reference_type?: string | null;
}

export interface AdvanceReconciliationRow {
  advanceId: string;
  sourceAmount: number;
  ledgerAmount: number;
  difference: number;
  matched: boolean;
}

export interface AdvanceReconciliationResult {
  sourceTotal: number;
  ledgerTotal: number;
  difference: number;
  matched: boolean;
  postedCount: number;
  unpostedCount: number;
  reversedCount: number;
  unpostedTotal: number;
  reversedTotal: number;
  rows: AdvanceReconciliationRow[];
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/* ------------------------------------------------------------------ *
 * Automated reversal integrity check
 * ------------------------------------------------------------------ */

export type ReversalIssueCode =
  | "amount_mismatch"
  | "missing_reversal"
  | "orphan_reversal"
  | "residual_balance";

export interface ReversalIntegrityIssue {
  advanceId: string;
  code: ReversalIssueCode;
  message: string;
  originalDr: number;
  originalCr: number;
  reversalDr: number;
  reversalCr: number;
  netEffect: number;
}

export interface ReversalIntegrityResult {
  checkedCount: number;
  balancedCount: number;
  issues: ReversalIntegrityIssue[];
  clean: boolean;
}

/**
 * Flags mismatched balances between the original staff advance posting and its
 * reversal journal: amounts that don't mirror, reversals with no original,
 * advances flagged reversed but with no reversal legs, and residual net balances.
 */
export function auditAdvanceReversalIntegrity(
  advances: AdvanceSourceRow[],
  legs: AdvanceLedgerLeg[]
): ReversalIntegrityResult {
  const byAdvance = new Map<
    string,
    { originalDr: number; originalCr: number; reversalDr: number; reversalCr: number; hasOriginal: boolean; hasReversal: boolean }
  >();

  const bucket = (id: string) => {
    let b = byAdvance.get(id);
    if (!b) {
      b = { originalDr: 0, originalCr: 0, reversalDr: 0, reversalCr: 0, hasOriginal: false, hasReversal: false };
      byAdvance.set(id, b);
    }
    return b;
  };

  for (const leg of legs) {
    if (leg.is_voided) continue;
    if (!leg.reference_id) continue;
    if (leg.account_code && !ADVANCE_RECEIVABLE_CODES.includes(leg.account_code)) continue;
    const b = bucket(leg.reference_id);
    const dr = Number(leg.debit || 0);
    const cr = Number(leg.credit || 0);
    if ((leg.reference_type ?? "").endsWith("_reversal")) {
      b.reversalDr += dr;
      b.reversalCr += cr;
      b.hasReversal = true;
    } else {
      b.originalDr += dr;
      b.originalCr += cr;
      b.hasOriginal = true;
    }
  }

  const advanceById = new Map(advances.map((a) => [a.id, a]));
  const issues: ReversalIntegrityIssue[] = [];
  let checkedCount = 0;
  let balancedCount = 0;

  const idsToCheck = new Set<string>();
  for (const a of advances) if (a.ledger_reversed) idsToCheck.add(a.id);
  for (const [id, b] of byAdvance) if (b.hasReversal) idsToCheck.add(id);

  for (const id of idsToCheck) {
    const b = byAdvance.get(id) ?? {
      originalDr: 0,
      originalCr: 0,
      reversalDr: 0,
      reversalCr: 0,
      hasOriginal: false,
      hasReversal: false,
    };
    const originalDr = round2(b.originalDr);
    const originalCr = round2(b.originalCr);
    const reversalDr = round2(b.reversalDr);
    const reversalCr = round2(b.reversalCr);
    const netEffect = round2(originalDr - originalCr + reversalDr - reversalCr);
    const base = { advanceId: id, originalDr, originalCr, reversalDr, reversalCr, netEffect };
    checkedCount += 1;

    if (!b.hasReversal) {
      issues.push({
        ...base,
        code: "missing_reversal",
        message: "Advance is marked reversed but no reversal journal legs were found.",
      });
      continue;
    }
    if (!b.hasOriginal) {
      issues.push({
        ...base,
        code: "orphan_reversal",
        message: "Reversal legs exist without a matching original advance posting.",
      });
      continue;
    }
    if (
      Math.abs(round2(originalDr - reversalCr)) > RECONCILIATION_TOLERANCE ||
      Math.abs(round2(originalCr - reversalDr)) > RECONCILIATION_TOLERANCE
    ) {
      issues.push({
        ...base,
        code: "amount_mismatch",
        message: "Reversal amounts do not mirror the original posting (DR↔CR).",
      });
      continue;
    }
    if (Math.abs(netEffect) > RECONCILIATION_TOLERANCE) {
      issues.push({
        ...base,
        code: "residual_balance",
        message: "Original and reversal do not net to zero on account 1150.",
      });
      continue;
    }
    if (!advanceById.get(id)?.ledger_reversed) {
      // reversal posted but source row not flagged — still balanced, no issue raised
    }
    balancedCount += 1;
  }

  return {
    checkedCount,
    balancedCount,
    issues,
    clean: issues.length === 0,
  };
}

export function reconcileStaffAdvances(
  advances: AdvanceSourceRow[],
  legs: AdvanceLedgerLeg[]
): AdvanceReconciliationResult {
  const ledgerByAdvance = new Map<string, number>();

  for (const leg of legs) {
    if (leg.is_voided) continue;
    if (!leg.reference_id) continue;
    if (leg.account_code && !ADVANCE_RECEIVABLE_CODES.includes(leg.account_code)) continue;
    // Recovery legs (repayment / payroll deduction) settle the advance; they must
    // not cancel out the original posting when reconciling what was granted.
    if (RECOVERY_REFERENCE_TYPES.includes(leg.reference_type ?? "")) continue;
    const net = Number(leg.debit || 0) - Number(leg.credit || 0);
    ledgerByAdvance.set(leg.reference_id, (ledgerByAdvance.get(leg.reference_id) ?? 0) + net);
  }

  const rows: AdvanceReconciliationRow[] = [];
  let sourceTotal = 0;
  let postedCount = 0;
  let unpostedCount = 0;
  let unpostedTotal = 0;
  let reversedCount = 0;
  let reversedTotal = 0;

  for (const advance of advances) {
    const amount = Number(advance.amount || 0);

    if (advance.ledger_reversed) {
      reversedCount += 1;
      reversedTotal += amount;
    } else if (!advance.ledger_posted) {
      unpostedCount += 1;
      unpostedTotal += amount;
      continue;
    } else {
      postedCount += 1;
      sourceTotal += amount;
    }

    const ledgerAmount = round2(ledgerByAdvance.get(advance.id) ?? 0);
    const expected = advance.ledger_reversed ? 0 : amount;
    const difference = round2(expected - ledgerAmount);
    rows.push({
      advanceId: advance.id,
      sourceAmount: round2(expected),
      ledgerAmount,
      difference,
      matched: Math.abs(difference) <= RECONCILIATION_TOLERANCE,
    });
  }

  const ledgerTotal = round2(
    Array.from(ledgerByAdvance.values()).reduce((s, v) => s + v, 0)
  );
  const difference = round2(round2(sourceTotal) - ledgerTotal);

  return {
    sourceTotal: round2(sourceTotal),
    ledgerTotal,
    difference,
    matched: Math.abs(difference) <= RECONCILIATION_TOLERANCE,
    postedCount,
    unpostedCount,
    reversedCount,
    unpostedTotal: round2(unpostedTotal),
    reversedTotal: round2(reversedTotal),
    rows,
  };
}

/* ------------------------------------------------------------------ *
 * Automated posting-status reconciliation
 *
 * Detects advances whose recorded state disagrees with the general ledger:
 * flagged as not posted while ledger legs exist (and vice versa), and
 * recovery state that the ledger does not back up.
 * ------------------------------------------------------------------ */

export type PostingStatusIssueCode =
  | "posted_flag_missing"
  | "posted_flag_without_ledger"
  | "recovered_without_ledger_recovery"
  | "ledger_recovery_without_status"
  | "reversed_flag_missing";

export type PostingStatusSeverity = "critical" | "warning";

export interface PostingStatusIssue {
  advanceId: string;
  staffName?: string | null;
  code: PostingStatusIssueCode;
  severity: PostingStatusSeverity;
  title: string;
  message: string;
  /** Amount recorded on the advance row. */
  recordedAmount: number;
  /** Net DR on 1150 from the original posting legs (excludes recovery). */
  ledgerPostedAmount: number;
  /** Credits to 1150 from repayments / payroll deductions. */
  ledgerRecoveredAmount: number;
  recordedRepaid: number;
  status: string | null;
}

export interface PostingStatusAuditResult {
  checkedCount: number;
  cleanCount: number;
  issues: PostingStatusIssue[];
  criticalCount: number;
  warningCount: number;
  clean: boolean;
}

const RECOVERY_REFERENCE_TYPES = ["staff_advance_repayment", "advance_deduction"];

/**
 * Cross-checks each advance's stored flags/status against its ledger legs.
 * Only legs on the advance receivable account (1150) are considered.
 */
export function auditAdvancePostingStatus(
  advances: AdvanceSourceRow[],
  legs: AdvanceLedgerLeg[]
): PostingStatusAuditResult {
  const buckets = new Map<
    string,
    { postedDr: number; postedCr: number; recoveredCr: number; hasOriginal: boolean; hasReversal: boolean }
  >();

  const bucket = (id: string) => {
    let b = buckets.get(id);
    if (!b) {
      b = { postedDr: 0, postedCr: 0, recoveredCr: 0, hasOriginal: false, hasReversal: false };
      buckets.set(id, b);
    }
    return b;
  };

  for (const leg of legs) {
    if (leg.is_voided) continue;
    if (!leg.reference_id) continue;
    if (leg.account_code && !ADVANCE_RECEIVABLE_CODES.includes(leg.account_code)) continue;
    const b = bucket(leg.reference_id);
    const type = leg.reference_type ?? "";
    const dr = Number(leg.debit || 0);
    const cr = Number(leg.credit || 0);
    if (RECOVERY_REFERENCE_TYPES.includes(type)) {
      b.recoveredCr += cr;
    } else if (type.endsWith("_reversal")) {
      b.hasReversal = true;
      b.postedDr += dr;
      b.postedCr += cr;
    } else {
      b.hasOriginal = true;
      b.postedDr += dr;
      b.postedCr += cr;
    }
  }

  const issues: PostingStatusIssue[] = [];
  let cleanCount = 0;

  for (const advance of advances) {
    const b = buckets.get(advance.id);
    const amount = round2(Number(advance.amount || 0));
    const recordedRepaid = round2(Number(advance.repaid_amount || 0));
    const ledgerPostedAmount = round2((b?.postedDr ?? 0) - (b?.postedCr ?? 0));
    const ledgerRecoveredAmount = round2(b?.recoveredCr ?? 0);
    const hasOriginal = b?.hasOriginal ?? false;
    const status = advance.status ?? null;
    const base = {
      advanceId: advance.id,
      staffName: advance.staff_name ?? null,
      recordedAmount: amount,
      ledgerPostedAmount,
      ledgerRecoveredAmount,
      recordedRepaid,
      status,
    };

    const found: PostingStatusIssue[] = [];

    if (!advance.ledger_posted && hasOriginal) {
      found.push({
        ...base,
        code: "posted_flag_missing",
        severity: "critical",
        title: "Marked unposted but present in the ledger",
        message:
          "Ledger legs exist on account 1150 while the advance is flagged as not posted — the flag or the journal is wrong.",
      });
    }

    if (advance.ledger_posted && !hasOriginal) {
      found.push({
        ...base,
        code: "posted_flag_without_ledger",
        severity: "critical",
        title: "Marked posted but missing from the ledger",
        message:
          "The advance is flagged as posted but no active journal legs were found on account 1150.",
      });
    }

    if (advance.ledger_reversed && !(b?.hasReversal ?? false)) {
      found.push({
        ...base,
        code: "reversed_flag_missing",
        severity: "critical",
        title: "Marked reversed without a reversal journal",
        message: "No reversal legs were found for an advance flagged as reversed.",
      });
    }

    const treatedAsRecovered =
      status === "deducted" ||
      (recordedRepaid > RECONCILIATION_TOLERANCE && !advance.ledger_reversed);

    if (
      treatedAsRecovered &&
      hasOriginal &&
      !advance.ledger_reversed &&
      Math.abs(round2(Math.min(recordedRepaid || amount, amount) - ledgerRecoveredAmount)) >
        RECONCILIATION_TOLERANCE
    ) {
      found.push({
        ...base,
        code: "recovered_without_ledger_recovery",
        severity: "warning",
        title: "Recovery recorded without matching ledger credit",
        message:
          "The advance is shown as recovered/repaid but account 1150 has not been credited by the same amount.",
      });
    }

    if (
      !treatedAsRecovered &&
      !advance.ledger_reversed &&
      ledgerRecoveredAmount > RECONCILIATION_TOLERANCE
    ) {
      found.push({
        ...base,
        code: "ledger_recovery_without_status",
        severity: "warning",
        title: "Ledger shows recovery but advance is still unpaid",
        message:
          "Account 1150 was credited for this advance while it is still listed as outstanding.",
      });
    }

    if (found.length === 0) cleanCount += 1;
    issues.push(...found);
  }

  const criticalCount = issues.filter((i) => i.severity === "critical").length;

  return {
    checkedCount: advances.length,
    cleanCount,
    issues,
    criticalCount,
    warningCount: issues.length - criticalCount,
    clean: issues.length === 0,
  };
}
