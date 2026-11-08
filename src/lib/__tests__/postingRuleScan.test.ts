import { describe, expect, it } from "vitest";
import {
  findingsToCsv,
  scanAccountClassification,
  scanExpenses,
  scanLedgerBatches,
  summariseScan,
  type ScanAccount,
  type ScanExpenseRow,
  type ScanLedgerLine,
} from "../postingRuleScan";

const acct = (
  id: string,
  code: string,
  name: string,
  type: string,
): ScanAccount => ({ id, account_code: code, account_name: name, account_type: type });

const equipment = acct("a1", "1510", "Kitchen Equipment", "asset");
const rent = acct("a2", "6100", "Rent", "expense");
const partnerLoan = acct("a3", "2415", "Partner Loan - Ali", "liability");
const sales = acct("a4", "4000", "Food Sales", "revenue");
const byId = new Map([equipment, rent, partnerLoan, sales].map((a) => [a.id, a]));

const expense = (over: Partial<ScanExpenseRow>): ScanExpenseRow => ({
  id: "e1",
  expense_date: "2026-05-01",
  description: "Fryer",
  amount: 4000,
  account_id: equipment.id,
  project_id: null,
  status: "paid",
  branch_id: null,
  ...over,
});

const line = (over: Partial<ScanLedgerLine>): ScanLedgerLine => ({
  id: "l1",
  batch_id: "b1",
  transaction_date: "2026-05-01",
  account_id: equipment.id,
  debit: 4000,
  credit: 0,
  description: "Fryer",
  is_voided: false,
  project_id: null,
  ...over,
});

describe("scanExpenses", () => {
  it("flags an expense charged to a fixed asset account", () => {
    const [f] = scanExpenses([expense({})], byId);
    expect(f.violation.rule).toBe("expense_to_fixed_asset");
    expect(f.source).toBe("expense");
    expect(f.violation.fixes.length).toBeGreaterThan(0);
  });

  it("ignores capitalised project spend", () => {
    expect(scanExpenses([expense({ project_id: "p1" })], byId)).toHaveLength(0);
  });

  it("flags a partner account used as an expense account", () => {
    const [f] = scanExpenses([expense({ account_id: partnerLoan.id })], byId);
    expect(f.violation.rule).toBe("partner_account_as_expense");
  });

  it("leaves ordinary expense accounts alone", () => {
    expect(scanExpenses([expense({ account_id: rent.id })], byId)).toHaveLength(0);
  });
});

describe("scanLedgerBatches", () => {
  it("flags partner funding posted alongside revenue", () => {
    const findings = scanLedgerBatches(
      [
        line({ id: "l1", account_id: partnerLoan.id, debit: 0, credit: 5000 }),
        line({ id: "l2", account_id: sales.id, debit: 5000, credit: 0 }),
      ],
      byId,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].violation.rule).toBe("partner_funding_as_revenue");
  });

  it("flags an unlinked fixed asset debit", () => {
    const findings = scanLedgerBatches([line({})], byId);
    expect(findings[0].violation.rule).toBe("expense_to_fixed_asset");
  });

  it("skips voided and project-linked lines", () => {
    expect(scanLedgerBatches([line({ is_voided: true })], byId)).toHaveLength(0);
    expect(scanLedgerBatches([line({ project_id: "p1" })], byId)).toHaveLength(0);
  });

  it("ignores clean batches", () => {
    const findings = scanLedgerBatches(
      [
        line({ id: "l1", account_id: rent.id, debit: 900, credit: 0 }),
        line({ id: "l2", account_id: sales.id, debit: 0, credit: 900 }),
      ],
      byId,
    );
    expect(findings).toHaveLength(0);
  });
});

describe("summariseScan", () => {
  it("counts findings by rule and reports scanned volume", () => {
    const s = summariseScan([expense({})], [line({ id: "l9" })], [equipment, rent, partnerLoan, sales]);
    expect(s.expensesScanned).toBe(1);
    expect(s.ledgerLinesScanned).toBe(1);
    expect(s.byRule.expense_to_fixed_asset).toBe(2);
  });
});

describe("scanAccountClassification", () => {
  it("flags a partner account typed as revenue", () => {
    const bad = acct("a9", "2420", "Partner Loan - Sara", "revenue");
    expect(scanAccountClassification([bad])[0].violation.rule).toBe("partner_funding_as_revenue");
    expect(scanAccountClassification([partnerLoan])).toHaveLength(0);
  });
});

describe("findingsToCsv", () => {
  it("emits a header and escapes quotes", () => {
    const csv = findingsToCsv(scanExpenses([expense({ description: 'Fryer "big"' })], byId));
    expect(csv.split("\n")[0]).toContain("How to fix");
    expect(csv).toContain('Fryer ""big""');
  });
});
