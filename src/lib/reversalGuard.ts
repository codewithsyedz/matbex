/**
 * Frontend guard for reversal postings.
 *
 * The database already refuses to link a reversal to an original that is
 * missing, already reversed, or voided. This module runs the same check in the
 * UI *before* a save so the user gets the current reversal status instead of a
 * constraint error after the fact.
 */

export type ReversalBlockCode =
  | "NOT_POSTED"
  | "ALREADY_REVERSED"
  | "INACTIVE"
  | "MISSING_ORIGINAL";

export interface ReversalSubject {
  /** Whether an original journal exists in the ledger for this document. */
  posted?: boolean | null;
  /** Ledger transaction/batch id of the original posting. */
  originalTransactionId?: string | null;
  /** Whether a reversal has already been posted against the original. */
  reversed?: boolean | null;
  reversedAt?: string | null;
  reversalReason?: string | null;
  /** Original posting no longer active (voided / deleted / cancelled). */
  inactive?: boolean | null;
  /** Optional label used in messages, e.g. "advance" or "payout". */
  label?: string;
}

export interface ReversalStatus {
  allowed: boolean;
  code?: ReversalBlockCode;
  /** Short badge text describing the current state of the original posting. */
  statusLabel: string;
  statusTone: "active" | "reversed" | "inactive" | "unposted";
  title?: string;
  description?: string;
  /** Concrete next steps shown under the message. */
  hints?: string[];
}

const fmtWhen = (iso?: string | null) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export function evaluateReversalEligibility(subject: ReversalSubject): ReversalStatus {
  const label = subject.label?.trim() || "posting";

  if (subject.reversed) {
    const when = fmtWhen(subject.reversedAt);
    return {
      allowed: false,
      code: "ALREADY_REVERSED",
      statusLabel: when ? `Reversed ${when}` : "Already reversed",
      statusTone: "reversed",
      title: "This posting is already reversed",
      description: when
        ? `A reversal journal was posted on ${when}${
            subject.reversalReason ? ` — "${subject.reversalReason}"` : ""
          }. The ledger impact is already offset, so a second reversal would double-count.`
        : `A reversal journal already exists for this ${label}, so its ledger impact is offset.`,
      hints: [
        "Open the ledger drilldown to confirm the net effect is zero.",
        `Record a fresh ${label} if the transaction needs to be re-entered.`,
      ],
    };
  }

  if (subject.inactive) {
    return {
      allowed: false,
      code: "INACTIVE",
      statusLabel: "Original inactive",
      statusTone: "inactive",
      title: "The original posting is no longer active",
      description: `The original journal for this ${label} was voided or removed, so there is nothing left to mirror.`,
      hints: [
        "Voided entries carry no balance — no reversal is required.",
        "Re-post the document if the balance should exist again.",
      ],
    };
  }

  if (subject.posted === false || (subject.posted == null && !subject.originalTransactionId)) {
    return {
      allowed: false,
      code: "NOT_POSTED",
      statusLabel: "Not posted",
      statusTone: "unposted",
      title: "Nothing has been posted to reverse",
      description: `This ${label} has no journal entry in the ledger yet.`,
      hints: [`Post the ${label} to the ledger first, then reverse it if needed.`],
    };
  }

  if (subject.posted && !subject.originalTransactionId) {
    return {
      allowed: false,
      code: "MISSING_ORIGINAL",
      statusLabel: "Original link missing",
      statusTone: "inactive",
      title: "The original journal link is missing",
      description: `This ${label} is flagged as posted but has no linked ledger transaction, so the reversal cannot be tied back to it.`,
      hints: [
        "Re-post the document so the ledger link is rebuilt.",
        "Contact an accountant if the entry exists in the ledger but is unlinked.",
      ],
    };
  }

  return { allowed: true, statusLabel: "Active", statusTone: "active" };
}

/** Single-line summary suitable for a toast description. */
export function formatReversalBlockToast(status: ReversalStatus): string {
  return [status.description, status.hints?.[0]].filter(Boolean).join(" ");
}

/** Error thrown by mutations so onError handlers can show the same message. */
export class ReversalBlockedError extends Error {
  status: ReversalStatus;
  constructor(status: ReversalStatus) {
    super(status.title ?? "Reversal blocked");
    this.name = "ReversalBlockedError";
    this.status = status;
  }
}
