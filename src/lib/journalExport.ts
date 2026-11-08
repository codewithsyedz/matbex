/**
 * Pure builders for accounting journal exports.
 *
 * Guarantees that every exported line keeps its branch_id stamp and resolves
 * to the same chart-of-accounts row the ledger posted to. Kept side-effect
 * free so it can be unit-tested end-to-end against the posting helpers.
 */
import type { CoaAccount, PostingLeg } from "@/lib/expensePostingRouting";

export interface JournalTransaction {
  id?: string;
  entry_date?: string | null;
  account_id: string;
  branch_id: string | null;
  debit: number | null;
  credit: number | null;
  description?: string | null;
  reference?: string | null;
}

export interface JournalExportOptions {
  accounts: CoaAccount[];
  branchNameById?: Record<string, string>;
  /** When set, only transactions stamped with this branch are exported. */
  branchId?: string | null;
}

export interface JournalExportRow {
  date: string;
  branchId: string;
  branchName: string;
  accountId: string;
  accountCode: string;
  accountName: string;
  description: string;
  reference: string;
  debit: number;
  credit: number;
}

export const JOURNAL_EXPORT_HEADERS = [
  "Date",
  "Branch",
  "Branch ID",
  "Account Code",
  "Account Name",
  "Account ID",
  "Description",
  "Reference",
  "Debit",
  "Credit",
] as const;

/** Turns posting legs into transaction rows exactly as the ledger stores them. */
export function legsToTransactions(
  legs: PostingLeg[],
  meta: { entryDate: string; description?: string; reference?: string },
): JournalTransaction[] {
  return legs.map((leg) => ({
    entry_date: meta.entryDate,
    account_id: leg.accountId,
    branch_id: leg.branchId,
    debit: leg.debit,
    credit: leg.credit,
    description: meta.description ?? null,
    reference: meta.reference ?? null,
  }));
}

export function buildJournalExportRows(
  transactions: JournalTransaction[],
  options: JournalExportOptions,
): JournalExportRow[] {
  const accountById = new Map(options.accounts.map((a) => [a.id, a]));
  const branchNameById = options.branchNameById ?? {};
  const scoped =
    options.branchId != null
      ? transactions.filter((t) => t.branch_id === options.branchId)
      : transactions;

  return scoped.map((t) => {
    const account = accountById.get(t.account_id);
    return {
      date: t.entry_date ?? "",
      branchId: t.branch_id ?? "",
      branchName: t.branch_id ? branchNameById[t.branch_id] ?? "Unknown branch" : "Unassigned",
      accountId: t.account_id,
      accountCode: account?.account_code ?? "",
      accountName: account?.account_name ?? "Unknown account",
      description: t.description ?? "",
      reference: t.reference ?? "",
      debit: Number(t.debit ?? 0),
      credit: Number(t.credit ?? 0),
    };
  });
}

export interface JournalExportTotals {
  debit: number;
  credit: number;
  difference: number;
  balanced: boolean;
}

export function journalExportTotals(rows: JournalExportRow[]): JournalExportTotals {
  const debit = rows.reduce((s, r) => s + r.debit, 0);
  const credit = rows.reduce((s, r) => s + r.credit, 0);
  const difference = Number((debit - credit).toFixed(2));
  return { debit, credit, difference, balanced: Math.abs(difference) < 0.005 };
}

export function journalExportTotalsByBranch(
  rows: JournalExportRow[],
): Record<string, JournalExportTotals> {
  const out: Record<string, JournalExportRow[]> = {};
  for (const row of rows) {
    (out[row.branchId || "__unassigned__"] ??= []).push(row);
  }
  return Object.fromEntries(
    Object.entries(out).map(([key, list]) => [key, journalExportTotals(list)]),
  );
}

const escape = (value: string | number) => {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Renders the CSV body, including per-branch subtotals and a grand total. */
export function toJournalCsv(rows: JournalExportRow[]): string {
  const lines: string[] = [JOURNAL_EXPORT_HEADERS.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.date,
        r.branchName,
        r.branchId,
        r.accountCode,
        r.accountName,
        r.accountId,
        r.description,
        r.reference,
        r.debit.toFixed(2),
        r.credit.toFixed(2),
      ]
        .map(escape)
        .join(","),
    );
  }

  const perBranch = journalExportTotalsByBranch(rows);
  lines.push("");
  lines.push("Totals by branch,,,,,,,,Debit,Credit");
  for (const [branchId, totals] of Object.entries(perBranch).sort()) {
    const name = rows.find((r) => (r.branchId || "__unassigned__") === branchId)?.branchName ?? "";
    lines.push(
      ["", name, branchId === "__unassigned__" ? "" : branchId, "", "", "", "", "", totals.debit.toFixed(2), totals.credit.toFixed(2)]
        .map(escape)
        .join(","),
    );
  }

  const grand = journalExportTotals(rows);
  lines.push(["TOTAL", "", "", "", "", "", "", "", grand.debit.toFixed(2), grand.credit.toFixed(2)].join(","));
  return lines.join("\n");
}
