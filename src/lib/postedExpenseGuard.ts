/**
 * Guard helpers for expenses that are already posted to the general ledger.
 *
 * A posted expense may not be silently edited: any change to a financially
 * material field must go through `amend_posted_expense`, which posts a
 * reversing adjusting journal entry and re-posts the corrected amounts.
 * The same rule is enforced in the database by `guard_posted_expense_edit`.
 */

export type MaterialExpenseValues = {
  amount: number;
  expenseDate: string;
  categoryId: string | null;
  accountId: string | null;
  supplierId: string | null;
};

export type MaterialChange = {
  field: keyof MaterialExpenseValues;
  label: string;
  from: string;
  to: string;
};

const LABELS: Record<keyof MaterialExpenseValues, string> = {
  amount: "Amount",
  expenseDate: "Expense date",
  categoryId: "Category",
  accountId: "Expense account",
  supplierId: "Supplier",
};

const show = (v: string | number | null): string =>
  v === null || v === "" ? "—" : String(v);

/** Returns the list of ledger-relevant fields that differ between two versions. */
export function getMaterialExpenseChanges(
  before: MaterialExpenseValues,
  after: MaterialExpenseValues
): MaterialChange[] {
  const changes: MaterialChange[] = [];
  (Object.keys(LABELS) as Array<keyof MaterialExpenseValues>).forEach((key) => {
    const a = before[key];
    const b = after[key];
    const same =
      key === "amount"
        ? Math.abs(Number(a || 0) - Number(b || 0)) < 0.005
        : (a ?? null) === (b ?? null);
    if (!same) {
      changes.push({
        field: key,
        label: LABELS[key],
        from: show(a as any),
        to: show(b as any),
      });
    }
  });
  return changes;
}

/** True when the edit needs an adjusting journal entry to stay auditable. */
export function requiresLedgerAdjustment(
  ledgerPosted: boolean | null | undefined,
  changes: MaterialChange[]
): boolean {
  return !!ledgerPosted && changes.length > 0;
}

/**
 * Roles allowed to amend a posted expense. Mirrors the role check inside the
 * `amend_posted_expense` database function — the UI gate is convenience only,
 * the database remains the source of truth.
 */
export const AMEND_POSTED_EXPENSE_ROLES = [
  "owner",
  "manager",
  "accountant",
  "superadmin",
] as const;

export type AmendRole = (typeof AMEND_POSTED_EXPENSE_ROLES)[number];

/** True when the current user holds one of the elevated amendment roles. */
export function canAmendPostedExpense(
  hasRole: (role: string) => boolean
): boolean {
  return AMEND_POSTED_EXPENSE_ROLES.some((role) => hasRole(role));
}

export const AMEND_PERMISSION_MESSAGE =
  "Amending a posted expense requires elevated access. Ask an owner, manager or accountant to post the adjusting entry.";
