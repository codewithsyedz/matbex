/**
 * Applies the ledger posting guards (partner-loan and fixed-asset rules) to
 * spreadsheet/CSV import rows during preview, so a bad sheet is caught before
 * anything reaches the ledger — with a per-row reason the user can act on.
 *
 * Mirrors `src/lib/accountPostingRules.ts`, which mirrors the DB triggers.
 */
import {
  checkExpenseNotFixedAsset,
  type CapexContext,
  type PostingAccount,
  type RuleViolation,
} from "@/lib/accountPostingRules";

export interface ImportRowAccount {
  /** 1-based sheet row number (header excluded), used in messages. */
  rowNumber: number;
  /** Raw account text from the sheet, for the error report. */
  accountText?: string;
  /** Resolved chart-of-accounts entry, or null when unresolved. */
  account: PostingAccount | null;
  amount?: number;
  vendor?: string;
}

export interface ImportRowViolation {
  rowNumber: number;
  accountText: string;
  violation: RuleViolation;
}

export interface ImportPostingRuleReport {
  /** Keyed by preview row index (position in the rows array). */
  byIndex: Record<number, RuleViolation>;
  violations: ImportRowViolation[];
  blockedCount: number;
  /** Distinct rules fired, most frequent first. */
  ruleCounts: { rule: RuleViolation["rule"]; count: number }[];
}

/** Evaluates one import row's debit account against the posting rules. */
export function checkImportRowAccount(
  account: PostingAccount | null | undefined,
  ctx: CapexContext = {},
): RuleViolation | null {
  if (!account) return null;
  return checkExpenseNotFixedAsset(account, ctx);
}

export function evaluateImportPostingRules(
  rows: ImportRowAccount[],
  ctx: CapexContext = {},
): ImportPostingRuleReport {
  const byIndex: Record<number, RuleViolation> = {};
  const violations: ImportRowViolation[] = [];
  const counts = new Map<RuleViolation["rule"], number>();

  rows.forEach((row, index) => {
    const violation = checkImportRowAccount(row.account, ctx);
    if (!violation) return;
    byIndex[index] = violation;
    violations.push({
      rowNumber: row.rowNumber,
      accountText:
        row.accountText ||
        (row.account ? `${row.account.account_code} · ${row.account.account_name}` : ""),
      violation,
    });
    counts.set(violation.rule, (counts.get(violation.rule) ?? 0) + 1);
  });

  return {
    byIndex,
    violations,
    blockedCount: violations.length,
    ruleCounts: [...counts.entries()]
      .map(([rule, count]) => ({ rule, count }))
      .sort((a, b) => b.count - a.count),
  };
}

const csvCell = (v: string) => `"${(v ?? "").replace(/"/g, '""')}"`;

export function importPostingRuleCsv(report: ImportPostingRuleReport): string {
  const lines = ["Sheet row,Rule,Account,Reason,How to fix"];
  for (const v of report.violations) {
    lines.push(
      [
        v.rowNumber,
        v.violation.rule,
        csvCell(v.accountText),
        csvCell(v.violation.message),
        csvCell(v.violation.fixes.map((f) => f.label).join(" | ")),
      ].join(","),
    );
  }
  return lines.join("\n");
}

export function downloadImportPostingRuleReport(
  report: ImportPostingRuleReport,
  fileName = "import-posting-rule-errors.csv",
) {
  const blob = new Blob([importPostingRuleCsv(report)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}