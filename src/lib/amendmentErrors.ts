/**
 * Human, actionable messages for `amend_posted_expense` failures.
 *
 * Postgres surfaces raw exception text (`permission denied`, `function ...
 * does not exist`, `period is locked`). Those are useless to a restaurant
 * manager, so we translate the known failure modes into a title + next step.
 */

import { AMEND_POSTED_EXPENSE_ROLES } from "./postedExpenseGuard";

/** Friendly labels for the roles that can amend a posted expense. */
export const AMEND_POSTED_EXPENSE_ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  manager: "Manager",
  accountant: "Accountant",
  superadmin: "Super Admin",
};

export type AmendErrorKind =
  | "permission"
  | "locked_period"
  | "not_posted"
  | "missing_function"
  | "validation"
  | "unknown";

export type AmendErrorInfo = {
  kind: AmendErrorKind;
  title: string;
  description: string;
  /** Roles that can complete the action, when the failure is a role gate. */
  requiredRoles?: readonly string[];
};

const ROLE_LIST = "owner, manager, accountant or superadmin";

export const AMEND_ROLE_ERROR: AmendErrorInfo = {
  kind: "permission",
  title: "You do not have permission to amend posted entries",
  description: `Amending a posted expense rewrites the general ledger, so it is limited to ${ROLE_LIST} users of this restaurant. Ask one of them to post the adjusting entry, or request the role from your owner.`,
  requiredRoles: AMEND_POSTED_EXPENSE_ROLES,
};

/** Maps a raw error from the amendment RPC to an actionable message. */
export function describeAmendError(error: unknown): AmendErrorInfo {
  const raw =
    typeof error === "string"
      ? error
      : ((error as any)?.message ?? (error as any)?.error_description ?? "");
  const msg = String(raw).toLowerCase();

  if (!msg) {
    return {
      kind: "unknown",
      title: "Amendment rejected",
      description:
        "The adjusting entry could not be posted. Nothing was changed — please retry, and contact support if it keeps failing.",
    };
  }

  if (
    msg.includes("permission") ||
    msg.includes("not authorized") ||
    msg.includes("not authorised") ||
    msg.includes("insufficient") ||
    msg.includes("elevated access") ||
    msg.includes("row-level security") ||
    msg.includes("has_role")
  ) {
    return AMEND_ROLE_ERROR;
  }

  if (msg.includes("lock") || msg.includes("closed period") || msg.includes("fiscal period")) {
    return {
      kind: "locked_period",
      title: "That accounting period is closed",
      description:
        "The expense falls inside a locked fiscal period, so its ledger entries are frozen. Ask an owner to reopen the period, or post the correction in the current open period instead.",
    };
  }

  if (msg.includes("not posted") || msg.includes("no journal") || msg.includes("no ledger")) {
    return {
      kind: "not_posted",
      title: "This expense is not posted yet",
      description:
        "There is no journal entry to reverse. Close the dialog and save the expense normally, or post it to the ledger first.",
    };
  }

  if (msg.includes("does not exist") || msg.includes("could not find the function")) {
    return {
      kind: "missing_function",
      title: "Amendments are temporarily unavailable",
      description:
        "A required database function is missing on this environment. Nothing was changed — please contact support so the pending database update can be applied.",
    };
  }

  if (
    msg.includes("reason") ||
    msg.includes("invalid") ||
    msg.includes("null value") ||
    msg.includes("violates")
  ) {
    return {
      kind: "validation",
      title: "Amendment details are incomplete",
      description:
        "Check the amount, date, category, account and reason, then try again. Nothing was changed.",
    };
  }

  return {
    kind: "unknown",
    title: "Amendment rejected",
    description: String(raw),
  };
}
