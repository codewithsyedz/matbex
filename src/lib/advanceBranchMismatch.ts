/**
 * Detects branch inconsistencies between a staff advance, the staff profile
 * it belongs to, and the ledger / payroll recovery entries created for it.
 *
 * Null branches are treated as "legacy / unscoped" and never reported as a
 * mismatch — only two different non-null branches count.
 */
export type AdvanceBranchIssueCode =
  | "staff_profile_branch"
  | "ledger_leg_branch"
  | "payroll_recovery_branch";

export interface AdvanceBranchIssue {
  code: AdvanceBranchIssueCode;
  message: string;
  expectedBranchId: string | null;
  foundBranchId: string | null;
}

export interface AdvanceBranchAuditInput {
  advanceBranchId?: string | null;
  staffBranchId?: string | null;
  /** branch_id of every non-voided ledger leg posted for the advance. */
  ledgerBranchIds?: (string | null | undefined)[];
  /** branch_id of every payroll run that recovered part of the advance. */
  payrollBranchIds?: (string | null | undefined)[];
  branchName?: (id: string | null | undefined) => string;
}

export function auditAdvanceBranchAlignment({
  advanceBranchId,
  staffBranchId,
  ledgerBranchIds = [],
  payrollBranchIds = [],
  branchName,
}: AdvanceBranchAuditInput): AdvanceBranchIssue[] {
  const label = (id: string | null | undefined) =>
    branchName?.(id) ?? (id ? `branch ${id.slice(0, 8)}` : "no branch");
  const issues: AdvanceBranchIssue[] = [];
  const base = advanceBranchId ?? null;
  if (!base) return issues;

  if (staffBranchId && staffBranchId !== base) {
    issues.push({
      code: "staff_profile_branch",
      message: `Advance is on ${label(base)} but the staff profile belongs to ${label(staffBranchId)}.`,
      expectedBranchId: base,
      foundBranchId: staffBranchId,
    });
  }

  const uniq = (ids: (string | null | undefined)[]) =>
    Array.from(new Set(ids.filter((id): id is string => !!id)));

  uniq(ledgerBranchIds)
    .filter((id) => id !== base)
    .forEach((id) =>
      issues.push({
        code: "ledger_leg_branch",
        message: `A ledger leg is posted to ${label(id)} instead of ${label(base)}.`,
        expectedBranchId: base,
        foundBranchId: id,
      })
    );

  uniq(payrollBranchIds)
    .filter((id) => id !== base)
    .forEach((id) =>
      issues.push({
        code: "payroll_recovery_branch",
        message: `A payroll recovery run sits on ${label(id)} instead of ${label(base)}.`,
        expectedBranchId: base,
        foundBranchId: id,
      })
    );

  return issues;
}