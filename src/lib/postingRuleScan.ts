/**
 * Bulk validator: replays the partner-loan and fixed-asset posting rules over
 * historical data so pre-existing rows that the new guards would now reject can
 * be found and corrected, rather than surfacing one at a time on the next edit.
 */
import {
  checkExpenseNotFixedAsset,
  checkPartnerFundingNotRevenue,
  isFixedAssetAccount,
  isPartnerFundingAccount,
  type PostingAccount,
  type RuleViolation,
} from "./accountPostingRules";

export interface ScanAccount extends PostingAccount {
  id: string;
}

export interface ScanExpenseRow {
  id: string;
  expense_date: string;
  description: string | null;
  amount: number;
  account_id: string | null;
  project_id: string | null;
  status: string | null;
  branch_id: string | null;
}

export interface ScanLedgerLine {
  id: string;
  batch_id: string | null;
  transaction_date: string;
  account_id: string;
  debit: number;
  credit: number;
  description: string | null;
  is_voided: boolean;
  project_id: string | null;
}

export type ScanSource = "expense" | "journal_batch";

export interface ScanFinding {
  key: string;
  source: ScanSource;
  /** Row id (expense) or batch id / line id (ledger). */
  recordId: string;
  date: string;
  label: string;
  amount: number;
  accounts: string[];
  violation: RuleViolation;
}

export interface ScanSummary {
  expensesScanned: number;
  ledgerLinesScanned: number;
  findings: ScanFinding[];
  byRule: Record<RuleViolation["rule"], number>;
}

const money = (n: unknown) => Number(n ?? 0);

/** Expenses charged to a fixed-asset or partner-funding account. */
export function scanExpenses(
  expenses: ScanExpenseRow[],
  accountsById: Map<string, ScanAccount>,
): ScanFinding[] {
  const findings: ScanFinding[] = [];
  for (const e of expenses) {
    if (!e.account_id) continue;
    const account = accountsById.get(e.account_id);
    if (!account) continue;

    // Historical rows linked to a project were legitimately capitalised.
    const violation = checkExpenseNotFixedAsset(account, { projectId: e.project_id });
    if (!violation) continue;

    findings.push({
      key: `expense:${e.id}`,
      source: "expense",
      recordId: e.id,
      date: e.expense_date,
      label: e.description?.trim() || "Expense",
      amount: money(e.amount),
      accounts: [`${account.account_code} · ${account.account_name}`],
      violation,
    });
  }
  return findings;
}

/**
 * Journal batches where partner funding sits alongside revenue, or where a
 * partner account is mis-typed. Voided lines are ignored — they carry no value.
 */
export function scanLedgerBatches(
  lines: ScanLedgerLine[],
  accountsById: Map<string, ScanAccount>,
): ScanFinding[] {
  const batches = new Map<string, ScanLedgerLine[]>();
  for (const l of lines) {
    if (l.is_voided) continue;
    const key = l.batch_id ?? `line:${l.id}`;
    const bucket = batches.get(key);
    if (bucket) bucket.push(l);
    else batches.set(key, [l]);
  }

  const findings: ScanFinding[] = [];
  for (const [batchKey, batchLines] of batches) {
    const accounts = batchLines
      .map((l) => accountsById.get(l.account_id))
      .filter((a): a is ScanAccount => Boolean(a));
    if (accounts.length === 0) continue;

    const partnerViolation = checkPartnerFundingNotRevenue(accounts);
    if (partnerViolation) {
      findings.push({
        key: `batch:${batchKey}:partner`,
        source: "journal_batch",
        recordId: batchLines[0].batch_id ?? batchLines[0].id,
        date: batchLines[0].transaction_date,
        label: batchLines[0].description?.trim() || "Journal entry",
        amount: batchLines.reduce((s, l) => s + money(l.debit), 0),
        accounts: accounts.map((a) => `${a.account_code} · ${a.account_name}`),
        violation: partnerViolation,
      });
      continue;
    }

    // A debit to a fixed asset account with no project link and no asset
    // register reference is exactly what the new trigger now blocks.
    for (const line of batchLines) {
      const account = accountsById.get(line.account_id);
      if (!account) continue;
      if (money(line.debit) <= 0) continue;
      if (!isFixedAssetAccount(account)) continue;
      if (line.project_id) continue;

      const violation = checkExpenseNotFixedAsset(account);
      if (!violation) continue;
      findings.push({
        key: `line:${line.id}`,
        source: "journal_batch",
        recordId: line.batch_id ?? line.id,
        date: line.transaction_date,
        label: line.description?.trim() || "Journal line",
        amount: money(line.debit),
        accounts: [`${account.account_code} · ${account.account_name}`],
        violation,
      });
    }
  }
  return findings;
}

export function summariseScan(
  expenses: ScanExpenseRow[],
  lines: ScanLedgerLine[],
  accounts: ScanAccount[],
): ScanSummary {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const findings = [...scanExpenses(expenses, byId), ...scanLedgerBatches(lines, byId)].sort(
    (a, b) => b.date.localeCompare(a.date),
  );

  const byRule = {
    partner_funding_as_revenue: 0,
    expense_to_fixed_asset: 0,
    partner_account_as_expense: 0,
  } as Record<RuleViolation["rule"], number>;
  for (const f of findings) byRule[f.violation.rule] += 1;

  return {
    expensesScanned: expenses.length,
    ledgerLinesScanned: lines.filter((l) => !l.is_voided).length,
    findings,
    byRule,
  };
}

/** Accounts whose classification itself breaks the partner-funding rule. */
export function scanAccountClassification(accounts: ScanAccount[]): ScanFinding[] {
  const findings: ScanFinding[] = [];
  for (const a of accounts) {
    if (!isPartnerFundingAccount(a)) continue;
    const violation = checkPartnerFundingNotRevenue([a]);
    if (!violation) continue;
    findings.push({
      key: `account:${a.id}`,
      source: "journal_batch",
      recordId: a.id,
      date: "",
      label: `${a.account_code} · ${a.account_name}`,
      amount: 0,
      accounts: [`${a.account_code} · ${a.account_name}`],
      violation,
    });
  }
  return findings;
}

export function findingsToCsv(findings: ScanFinding[]): string {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const header = ["Date", "Source", "Record", "Description", "Amount", "Accounts", "Rule", "Issue", "How to fix"];
  const rows = findings.map((f) =>
    [
      f.date,
      f.source === "expense" ? "Expense" : "Journal entry",
      f.recordId,
      f.label,
      f.amount.toFixed(2),
      f.accounts.join(" | "),
      f.violation.rule,
      f.violation.title,
      f.violation.fixes.map((x) => x.label).join(" | "),
    ]
      .map((c) => esc(String(c)))
      .join(","),
  );
  return [header.map(esc).join(","), ...rows].join("\n");
}
