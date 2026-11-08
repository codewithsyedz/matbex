/**
 * Translates database reversal-linkage constraint failures (from
 * validate_reversal_linkage() and uq_active_reversal_per_original) into
 * user-friendly messages with concrete guidance on fixing the
 * original_transaction_id linkage.
 */

export interface ReversalLinkageError {
  /** Short toast title. */
  title: string;
  /** Plain-language explanation of what the database rejected. */
  description: string;
  /** Ordered, actionable steps to fix the linkage. */
  fixSteps: string[];
  /** Machine code for tests/telemetry. */
  code: ReversalLinkageCode;
  /** Raw database message, kept for the details disclosure. */
  raw: string;
}

export type ReversalLinkageCode =
  | "link_required"
  | "original_missing"
  | "self_reference"
  | "reverse_of_reversal"
  | "type_mismatch"
  | "tenant_mismatch"
  | "document_mismatch"
  | "account_mismatch"
  | "branch_mismatch"
  | "mirror_mismatch"
  | "already_reversed"
  | "unknown";

const has = (msg: string, ...needles: string[]) =>
  needles.every((n) => msg.toLowerCase().includes(n.toLowerCase()));

export function isReversalLinkageError(message?: string | null): boolean {
  if (!message) return false;
  return (
    message.includes("REVERSAL_LINK_REQUIRED") ||
    message.includes("REVERSAL_LINK_INVALID") ||
    message.includes("REVERSAL_MIRROR_INVALID") ||
    message.includes("uq_active_reversal_per_original")
  );
}

export function parseReversalLinkageError(
  error: unknown
): ReversalLinkageError | null {
  const raw =
    typeof error === "string"
      ? error
      : (error as { message?: string } | null)?.message ?? "";
  if (!isReversalLinkageError(raw)) return null;

  if (raw.includes("uq_active_reversal_per_original")) {
    return {
      code: "already_reversed",
      title: "This entry was already reversed",
      description:
        "An active reversal already exists for the original ledger line, so a second reversal can't be created.",
      fixSteps: [
        "Open the ledger drilldown and check the existing reversal journal.",
        "If that reversal was posted in error, void it first — then post a new one.",
        "If you meant to reverse a different line, pick the correct original entry.",
      ],
      raw,
    };
  }

  if (raw.includes("REVERSAL_LINK_REQUIRED")) {
    return {
      code: "link_required",
      title: "Reversal is missing its original entry link",
      description:
        "Every reversal line must point at the original ledger line it cancels (original_transaction_id was empty).",
      fixSteps: [
        "Re-run the reversal from the entry's ledger drilldown so the original line is picked automatically.",
        "Avoid creating reversal journals manually — they can't be saved without the linkage.",
        "If the original posting is missing entirely, repost it before reversing.",
      ],
      raw,
    };
  }

  if (has(raw, "does not exist") || has(raw, "not found")) {
    return {
      code: "original_missing",
      title: "Linked original entry not found",
      description:
        "The original_transaction_id on the reversal doesn't match any ledger line, so the link can't be verified.",
      fixSteps: [
        "Refresh the page — the original entry may have been voided or replaced since you opened it.",
        "Open the ledger drilldown and confirm the original posting still exists.",
        "Repost the original entry, then reverse it from the drilldown.",
      ],
      raw,
    };
  }

  if (has(raw, "cannot reverse itself")) {
    return {
      code: "self_reference",
      title: "Reversal points at itself",
      description:
        "The reversal line references its own id instead of the original ledger line.",
      fixSteps: [
        "Retry the reversal from the entry's ledger drilldown instead of a manual journal.",
        "If this repeats, report it — the posting routine is passing the wrong id.",
      ],
      raw,
    };
  }

  if (has(raw, "cannot reverse a reversal")) {
    return {
      code: "reverse_of_reversal",
      title: "You can't reverse a reversal",
      description:
        "The selected original line is itself a reversal journal, which the ledger doesn't allow you to cancel again.",
      fixSteps: [
        "Select the original posting (not the reversal) as the entry to cancel.",
        "To undo a reversal, void it and repost the original instead.",
      ],
      raw,
    };
  }

  if (has(raw, "must reverse a")) {
    return {
      code: "type_mismatch",
      title: "Reversal type doesn't match the original",
      description:
        "The reversal's document type differs from the original entry it links to (for example a staff advance reversal pointing at a settlement line).",
      fixSteps: [
        "Reverse the entry from its own screen so the correct document type is used.",
        "Confirm you selected the right original entry before reversing.",
      ],
      raw,
    };
  }

  if (has(raw, "tenant")) {
    return {
      code: "tenant_mismatch",
      title: "Original entry belongs to another account",
      description:
        "The linked original ledger line is owned by a different tenant, so the reversal was blocked.",
      fixSteps: [
        "Exit any impersonation or test-as mode and retry.",
        "Make sure you're working in the correct workspace before reversing.",
      ],
      raw,
    };
  }

  if (has(raw, "same source document")) {
    return {
      code: "document_mismatch",
      title: "Reversal points at a different document",
      description:
        "The reversal references a different source record than the original entry (mismatched reference id).",
      fixSteps: [
        "Retry from the drilldown of the record you actually want to reverse.",
        "Verify the advance/deposit you selected matches the original journal.",
      ],
      raw,
    };
  }

  if (has(raw, "same account")) {
    return {
      code: "account_mismatch",
      title: "Reversal posts to the wrong account",
      description:
        "A reversal leg must hit the same chart-of-accounts line as the original entry it cancels.",
      fixSteps: [
        "Check whether the account mapping changed since the original entry was posted.",
        "Restore the original account mapping, then retry the reversal.",
      ],
      raw,
    };
  }

  if (has(raw, "branch")) {
    return {
      code: "branch_mismatch",
      title: "Reversal branch doesn't match the original",
      description:
        "The reversal is being posted to a different branch than the original ledger line.",
      fixSteps: [
        "Switch to the branch the original entry was posted in and retry.",
        "If the record was moved between branches, correct its branch first, then reverse.",
      ],
      raw,
    };
  }

  if (raw.includes("REVERSAL_MIRROR_INVALID")) {
    return {
      code: "mirror_mismatch",
      title: "Reversal amounts don't mirror the original",
      description:
        "A reversal must flip the original exactly — the original debit becomes the credit and vice versa. The amounts didn't match.",
      fixSteps: [
        "Don't edit the amount on a reversal; reverse the full original entry.",
        "For a partial correction, post an adjusting journal instead of a reversal.",
        "Re-check the original entry's amount in the ledger drilldown.",
      ],
      raw,
    };
  }

  return {
    code: "unknown",
    title: "Reversal rejected by ledger safeguards",
    description:
      "The database blocked this reversal because its link to the original entry failed validation.",
    fixSteps: [
      "Retry the reversal from the entry's ledger drilldown.",
      "If it keeps failing, share the technical details below with support.",
    ],
    raw,
  };
}

/** Toast-ready description combining the explanation and the first fix steps. */
export function formatReversalLinkageToast(parsed: ReversalLinkageError): string {
  return `${parsed.description} Try this: ${parsed.fixSteps[0]}`;
}