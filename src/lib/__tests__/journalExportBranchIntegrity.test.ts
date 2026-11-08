/**
 * End-to-end regression: expense/payment postings -> ledger transactions ->
 * exported journal CSV. Verifies branch_id stamping survives the export and
 * that each line resolves to the branch-routed chart-of-accounts row.
 */
import { describe, it, expect } from "vitest";
import {
  buildExpensePostingLegs,
  buildEventSequenceLegs,
  type CoaAccount,
} from "@/lib/expensePostingRouting";
import {
  legsToTransactions,
  buildJournalExportRows,
  journalExportTotals,
  journalExportTotalsByBranch,
  toJournalCsv,
  JOURNAL_EXPORT_HEADERS,
} from "@/lib/journalExport";

const PARENT_EXPENSE = "acc-exp";
const PARENT_CASH = "acc-cash";
const PARENT_AP = "acc-ap";

const accounts: CoaAccount[] = [
  { id: PARENT_EXPENSE, account_code: "5000", account_name: "Food Cost", parent_id: null },
  { id: "exp-wadi", account_code: "5000-2", account_name: "Food Cost - Al-Wadi", parent_id: PARENT_EXPENSE },
  { id: PARENT_CASH, account_code: "1000", account_name: "Cash on Hand", parent_id: null },
  { id: "cash-wadi", account_code: "1000-2", account_name: "Cash on Hand - Al-Wadi", parent_id: PARENT_CASH },
  { id: PARENT_AP, account_code: "2000", account_name: 'Accounts Payable, "Trade"', parent_id: null },
  { id: "ap-wadi", account_code: "2000-2", account_name: "Accounts Payable - Al-Wadi", parent_id: PARENT_AP },
];

const counterAccountIdByCode = { "1000": PARENT_CASH, "2000": PARENT_AP };
const branchNameById = { "branch-wadi": "Al-Wadi", "branch-hq": "Riyadh HQ" };

const wadiPosting = buildExpensePostingLegs({
  amount: 1000,
  status: "unpaid",
  branchId: "branch-wadi",
  branchName: "Al-Wadi",
  debitAccountId: PARENT_EXPENSE,
  counterAccountIdByCode,
  accounts,
});

const hqPosting = buildExpensePostingLegs({
  amount: 400,
  status: "paid",
  branchId: "branch-hq",
  branchName: "Riyadh HQ",
  debitAccountId: PARENT_EXPENSE,
  counterAccountIdByCode,
  accounts,
});

const wadiEvents = buildEventSequenceLegs(
  [
    { kind: "payment", amount: 600 },
    { kind: "refund", amount: 100 },
    { kind: "chargeback", amount: 600 },
  ],
  {
    branchId: "branch-wadi",
    branchName: "Al-Wadi",
    expenseAccountId: PARENT_EXPENSE,
    counterAccountIdByCode,
    accounts,
    againstPayable: true,
  },
);

const transactions = [
  ...legsToTransactions(wadiPosting, { entryDate: "2026-07-01", description: "Vegetables", reference: "EXP-1" }),
  ...legsToTransactions(hqPosting, { entryDate: "2026-07-01", description: "Cleaning", reference: "EXP-2" }),
  ...legsToTransactions(wadiEvents, { entryDate: "2026-07-05", description: "Settlement", reference: "EXP-1" }),
];

describe("journal export preserves branch stamping", () => {
  it("keeps branch_id on every exported line", () => {
    const rows = buildJournalExportRows(transactions, { accounts, branchNameById });
    expect(rows).toHaveLength(transactions.length);
    expect(rows.every((r) => r.branchId !== "")).toBe(true);
    expect(new Set(rows.map((r) => r.branchId))).toEqual(new Set(["branch-wadi", "branch-hq"]));
  });

  it("maps branch names and never silently drops an unknown branch", () => {
    const rows = buildJournalExportRows(
      [{ account_id: PARENT_CASH, branch_id: "branch-ghost", debit: 10, credit: null }],
      { accounts, branchNameById },
    );
    expect(rows[0].branchId).toBe("branch-ghost");
    expect(rows[0].branchName).toBe("Unknown branch");
  });

  it("labels tenant-wide rows as Unassigned instead of blanking them", () => {
    const rows = buildJournalExportRows(
      [{ account_id: PARENT_CASH, branch_id: null, debit: 10, credit: null }],
      { accounts, branchNameById },
    );
    expect(rows[0].branchName).toBe("Unassigned");
    expect(rows[0].branchId).toBe("");
  });
});

describe("journal export resolves the posted account", () => {
  it("exports the branch sub-account code/name that was actually posted", () => {
    const rows = buildJournalExportRows(transactions, { accounts, branchNameById, branchId: "branch-wadi" });
    const codes = new Set(rows.map((r) => r.accountCode));
    expect(codes).toEqual(new Set(["5000-2", "1000-2", "2000-2"]));
    expect(rows.every((r) => r.accountName.includes("Al-Wadi"))).toBe(true);
  });

  it("falls back to the parent account for branches without sub-accounts", () => {
    const rows = buildJournalExportRows(transactions, { accounts, branchNameById, branchId: "branch-hq" });
    expect(new Set(rows.map((r) => r.accountCode))).toEqual(new Set(["5000", "1000"]));
  });

  it("flags an unknown account instead of exporting an empty name", () => {
    const rows = buildJournalExportRows(
      [{ account_id: "missing", branch_id: "branch-wadi", debit: 5, credit: null }],
      { accounts, branchNameById },
    );
    expect(rows[0].accountName).toBe("Unknown account");
    expect(rows[0].accountId).toBe("missing");
  });
});

describe("journal export totals", () => {
  it("balances overall and per branch", () => {
    const rows = buildJournalExportRows(transactions, { accounts, branchNameById });
    expect(journalExportTotals(rows).balanced).toBe(true);
    const byBranch = journalExportTotalsByBranch(rows);
    expect(byBranch["branch-wadi"].balanced).toBe(true);
    expect(byBranch["branch-hq"].balanced).toBe(true);
  });

  it("stays balanced when filtered to a single branch", () => {
    for (const branchId of ["branch-wadi", "branch-hq"]) {
      const rows = buildJournalExportRows(transactions, { accounts, branchNameById, branchId });
      const totals = journalExportTotals(rows);
      expect(totals.balanced).toBe(true);
      expect(rows.every((r) => r.branchId === branchId)).toBe(true);
    }
  });

  it("branch subtotals add up to the unfiltered totals", () => {
    const all = journalExportTotals(buildJournalExportRows(transactions, { accounts, branchNameById }));
    const parts = ["branch-wadi", "branch-hq"].map((branchId) =>
      journalExportTotals(buildJournalExportRows(transactions, { accounts, branchNameById, branchId })),
    );
    expect(parts.reduce((s, p) => s + p.debit, 0)).toBeCloseTo(all.debit, 2);
    expect(parts.reduce((s, p) => s + p.credit, 0)).toBeCloseTo(all.credit, 2);
  });
});

describe("journal CSV rendering", () => {
  const rows = buildJournalExportRows(transactions, { accounts, branchNameById });
  const csv = toJournalCsv(rows);
  const lines = csv.split("\n");

  it("emits the branch columns in the header", () => {
    expect(lines[0]).toBe(JOURNAL_EXPORT_HEADERS.join(","));
    expect(lines[0]).toContain("Branch ID");
  });

  it("writes a branch id on every data line", () => {
    const dataLines = lines.slice(1, 1 + rows.length);
    expect(dataLines).toHaveLength(rows.length);
    for (const line of dataLines) {
      expect(line.split(",").some((cell) => cell.startsWith("branch-"))).toBe(true);
    }
  });

  it("escapes account names containing commas and quotes", () => {
    const escaped = toJournalCsv(
      buildJournalExportRows(
        [{ account_id: PARENT_AP, branch_id: null, debit: null, credit: 12 }],
        { accounts, branchNameById },
      ),
    );
    expect(escaped).toContain('"Accounts Payable, ""Trade"""');
  });

  it("ends with a balanced grand total row", () => {
    const totalLine = lines[lines.length - 1].split(",");
    expect(totalLine[0]).toBe("TOTAL");
    expect(Number(totalLine[8])).toBeCloseTo(Number(totalLine[9]), 2);
  });
});
