/**
 * Pure helpers for Day-End reconciliation math.
 *
 * These functions are the single source of truth used by:
 *   - DailySalesRecorder (Adjusted Total / variance display)
 *   - DayEndAdjustmentDialog (DR/CR ledger preview)
 *   - The ledger trigger `post_day_end_adjustment_to_ledger` (mirror logic)
 *
 * Keep them dependency-free so the regression suite in
 * `src/lib/__tests__/dayEndReconciliation.test.ts` can exhaustively verify
 * that reconciled totals always match the intended ledger behavior.
 */

export type LedgerLine = {
  account: "1000" | "6999";
  /** Always positive. Use `account` + `side` to determine direction. */
  amount: number;
  side: "debit" | "credit";
};

export type AdjustmentRecord = {
  /** Signed amount: + = overage, − = shortage. */
  amount: number;
  reversed: boolean;
  /** True if this row IS itself a reversal entry (mirror of an original). */
  isReversalEntry: boolean;
};

/** Variance vs system POS transactions (what the operator must reconcile). */
export function calcVariance(posReportedTotal: number, systemTotal: number): number {
  return round2(posReportedTotal - systemTotal);
}

/** Net of all *active* day-end adjustments for a scope (excludes reversals + reversed). */
export function netActiveAdjustments(rows: AdjustmentRecord[]): number {
  return round2(
    rows
      .filter((r) => !r.reversed && !r.isReversalEntry)
      .reduce((sum, r) => sum + r.amount, 0),
  );
}

/**
 * Reconciled total to display as "Adjusted Total".
 *
 * Day-end adjustments are cash-reconciliation entries (DR Cash / CR Cash
 * Over-Short or vice-versa) - they do NOT add revenue. The reconciled total
 * for the day is therefore the POS Reported Total once an adjustment exists.
 * If no POS Reported value is set we fall back to the recorded payment-type
 * total + net adjustment.
 */
export function reconciledTotal(opts: {
  recordedTotal: number;
  posReportedTotal: number;
  netAdjustment: number;
}): number {
  const { recordedTotal, posReportedTotal, netAdjustment } = opts;
  if (posReportedTotal && posReportedTotal > 0) return round2(posReportedTotal);
  return round2(recordedTotal + netAdjustment);
}

/**
 * Build the exact DR/CR rows that `post_day_end_adjustment_to_ledger` will
 * post. Mirrors the PL/pgSQL function so the UI preview and the DB stay in
 * lockstep.
 */
export function buildAdjustmentLedger(signedAmount: number): LedgerLine[] {
  if (!Number.isFinite(signedAmount) || signedAmount === 0) return [];
  const abs = round2(Math.abs(signedAmount));
  if (signedAmount > 0) {
    // Overage: DR Cash on Hand / CR Cash Over-Short
    return [
      { account: "1000", side: "debit", amount: abs },
      { account: "6999", side: "credit", amount: abs },
    ];
  }
  // Shortage: DR Cash Over-Short / CR Cash on Hand
  return [
    { account: "6999", side: "debit", amount: abs },
    { account: "1000", side: "credit", amount: abs },
  ];
}

/** Mirror legs for a reversal - opposite side of the original. */
export function buildReversalLedger(signedAmount: number): LedgerLine[] {
  return buildAdjustmentLedger(-signedAmount);
}

/** A balanced batch must have ΣDR === ΣCR and at least one debit. */
export function isBalanced(lines: LedgerLine[]): boolean {
  const dr = lines.filter((l) => l.side === "debit").reduce((s, l) => s + l.amount, 0);
  const cr = lines.filter((l) => l.side === "credit").reduce((s, l) => s + l.amount, 0);
  return dr > 0 && Math.abs(round2(dr) - round2(cr)) < 0.005;
}

/**
 * Net effect of a list of adjustment rows on a single account, after
 * accounting for reversals. Returns signed amount (debit positive,
 * credit negative) for the requested account.
 */
export function netAccountEffect(
  rows: AdjustmentRecord[],
  account: "1000" | "6999",
): number {
  let net = 0;
  for (const r of rows) {
    // Reversed originals AND their mirror reversal entries cancel out - but
    // we model them separately to mirror the actual ledger behavior.
    const lines = r.isReversalEntry
      ? buildReversalLedger(-r.amount) // reversal row stored as flipped sign already
      : buildAdjustmentLedger(r.amount);
    for (const l of lines) {
      if (l.account !== account) continue;
      net += l.side === "debit" ? l.amount : -l.amount;
    }
  }
  return round2(net);
}

function round2(n: number): number {
  const r = Math.round(n * 100) / 100;
  return r === 0 ? 0 : r; // normalize -0 → 0
}