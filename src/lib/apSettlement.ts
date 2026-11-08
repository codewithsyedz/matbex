/**
 * Accounts Payable settlement guards (UI mirror of the DB triggers).
 *
 * Posted settlement / reversal batches (EXPPAY- / EXPPAYREV-) are immutable at
 * the database level. The UI must never offer edit, delete or void on their
 * ledger legs — the only correct correction path is posting a reversal.
 */
export type SettlementKind = "settlement" | "reversal" | null;

export function settlementKindOf(referenceNumber?: string | null): SettlementKind {
  const ref = referenceNumber ?? "";
  if (ref.startsWith("EXPPAYREV-")) return "reversal";
  if (ref.startsWith("EXPPAY-")) return "settlement";
  return null;
}

export function isPostedSettlementRef(referenceNumber?: string | null): boolean {
  return settlementKindOf(referenceNumber) !== null;
}

export const SETTLEMENT_LOCK_LABEL = "Reversal required";

export function settlementLockReason(kind: SettlementKind): string {
  if (kind === "reversal")
    return "This is a posted payment reversal. Reversal entries are immutable — post a new settlement to re-apply the payment.";
  return "This is a posted AP settlement. Settlement entries are immutable — mark the expense as unpaid to post a reversal entry instead of editing or voiding this line.";
}
