import { describe, expect, it } from "vitest";
import {
  buildInstallmentReconRows,
  computeReconTotals,
  resolveExpectedCreditAccountId,
  checkExpectedAccountMapping,
  type ReconAccount,
} from "@/lib/installmentRecon";

const ACC = {
  bnpl: { id: "acc-bnpl", account_code: "2450", account_name: "BNPL Payable", account_type: "liability" },
  bank: { id: "acc-bank", account_code: "1010", account_name: "Bank", account_type: "asset" },
  cash: { id: "acc-cash", account_code: "1000", account_name: "Cash in hand", account_type: "asset" },
  equity: { id: "acc-equity", account_code: "3401", account_name: "Partner capital – S. Raza", account_type: "equity" },
} satisfies Record<string, ReconAccount>;

const accById = new Map<string, ReconAccount>(Object.values(ACC).map((a) => [a.id, a]));

const planById = new Map([
  ["plan-1", { id: "plan-1", description: "Refrigerator", provider: "tabby", supplier_name: "Acme", installment_count: 6 }],
]);

/** capital_account_id (owner_capital_accounts.id) -> chart-of-accounts equity id */
const equityByCapitalId = new Map<string, string | null>([
  ["cap-1", ACC.equity.id],
  ["cap-orphan", null],
]);

const payment = (over: Record<string, any> = {}) => ({
  id: "pay-1",
  plan_id: "plan-1",
  branch_id: "br-1",
  installment_no: 1,
  due_date: "2026-06-01",
  paid_date: "2026-06-01",
  amount: 600,
  paid_amount: 600,
  status: "paid",
  funding_source: "company",
  payment_account_id: ACC.bank.id,
  capital_account_id: null,
  reference_number: "INS-1",
  batch_id: "batch-1",
  voided_at: null,
  ...over,
});

const batch = (creditAccountId: string, amount = 600, extra: any[] = []) =>
  new Map<string, any[]>([
    [
      "batch-1",
      [
        { account_id: ACC.bnpl.id, debit: amount, credit: 0, is_voided: false, transaction_date: "2026-06-01", batch_id: "batch-1" },
        { account_id: creditAccountId, debit: 0, credit: amount, is_voided: false, transaction_date: "2026-06-01", batch_id: "batch-1" },
        ...extra,
      ],
    ],
  ]);

const run = (payments: any[], txnsByBatch: Map<string, any[]>, today = "2026-06-10") =>
  buildInstallmentReconRows({ payments, planById, txnsByBatch, accById, equityByCapitalId, today });

describe("resolveExpectedCreditAccountId", () => {
  it("maps a partner capital record id to its chart-of-accounts equity id", () => {
    expect(
      resolveExpectedCreditAccountId(
        { funding_source: "partner", capital_account_id: "cap-1", payment_account_id: null },
        equityByCapitalId,
      ),
    ).toBe(ACC.equity.id);
  });

  it("never returns the raw owner_capital_accounts id", () => {
    const resolved = resolveExpectedCreditAccountId(
      { funding_source: "partner", capital_account_id: "cap-1" },
      equityByCapitalId,
    );
    expect(resolved).not.toBe("cap-1");
  });

  it("returns null when the partner capital account has no equity account linked", () => {
    expect(
      resolveExpectedCreditAccountId(
        { funding_source: "partner", capital_account_id: "cap-orphan" },
        equityByCapitalId,
      ),
    ).toBeNull();
  });

  it("returns null when a partner-funded payment has no capital account", () => {
    expect(
      resolveExpectedCreditAccountId(
        { funding_source: "partner", capital_account_id: null, payment_account_id: ACC.bank.id },
        equityByCapitalId,
      ),
    ).toBeNull();
  });

  it("uses the payment account for company-funded payments", () => {
    expect(
      resolveExpectedCreditAccountId(
        { funding_source: "company", payment_account_id: ACC.cash.id },
        equityByCapitalId,
      ),
    ).toBe(ACC.cash.id);
  });
});

describe("buildInstallmentReconRows – account matching", () => {
  it("matches a company-funded payment credited to the same bank account", () => {
    const [row] = run([payment()], batch(ACC.bank.id));
    expect(row.matchStatus).toBe("matched");
    expect(row.expected_credit_account_id).toBe(ACC.bank.id);
    expect(row.actual_credit_account_id).toBe(ACC.bank.id);
    expect(row.issues).toHaveLength(0);
  });

  it("matches a partner-funded payment credited to the partner equity account", () => {
    const [row] = run(
      [payment({ funding_source: "partner", capital_account_id: "cap-1", payment_account_id: null })],
      batch(ACC.equity.id),
    );
    expect(row.expected_credit_account_id).toBe(ACC.equity.id);
    expect(row.actual_credit_account_id).toBe(ACC.equity.id);
    expect(row.matchStatus).toBe("matched");
  });

  it("does not raise a false mismatch by comparing capital_account_id to the ledger account", () => {
    const [row] = run(
      [payment({ funding_source: "partner", capital_account_id: "cap-1", payment_account_id: null })],
      batch(ACC.equity.id),
    );
    expect(row.matchStatus).not.toBe("account_mismatch");
  });

  it("flags a partner payment credited to the wrong account", () => {
    const [row] = run(
      [payment({ funding_source: "partner", capital_account_id: "cap-1", payment_account_id: null })],
      batch(ACC.cash.id),
    );
    expect(row.matchStatus).toBe("account_mismatch");
    expect(row.issues[0]).toContain("3401");
    expect(row.issues[0]).toContain("1000");
  });

  it("flags a company payment credited to a different account than selected", () => {
    const [row] = run([payment({ payment_account_id: ACC.cash.id })], batch(ACC.bank.id));
    expect(row.matchStatus).toBe("account_mismatch");
  });

  it("cannot mismatch when the expected account is unresolvable", () => {
    const [row] = run(
      [payment({ funding_source: "partner", capital_account_id: "cap-orphan", payment_account_id: null })],
      batch(ACC.cash.id),
    );
    expect(row.expected_credit_account_id).toBeNull();
    expect(row.matchStatus).toBe("matched");
  });

  it("flags a settlement with no liability debit", () => {
    const txns = new Map<string, any[]>([
      [
        "batch-1",
        [
          { account_id: ACC.cash.id, debit: 600, credit: 0, is_voided: false, transaction_date: "2026-06-01" },
          { account_id: ACC.bank.id, debit: 0, credit: 600, is_voided: false, transaction_date: "2026-06-01" },
        ],
      ],
    ]);
    const [row] = run([payment()], txns);
    expect(row.liabilityDebit).toBe(0);
    expect(row.matchStatus).toBe("account_mismatch");
    expect(row.issues.join(" ")).toContain("BNPL payable");
  });

  it("ignores voided ledger lines when resolving the credited account", () => {
    const txns = batch(ACC.bank.id, 600, [
      { account_id: ACC.cash.id, debit: 0, credit: 999, is_voided: true, transaction_date: "2026-06-01" },
    ]);
    const [row] = run([payment()], txns);
    expect(row.actual_credit_account_id).toBe(ACC.bank.id);
    expect(row.cashCredit).toBe(600);
    expect(row.matchStatus).toBe("matched");
  });
});

describe("buildInstallmentReconRows – status precedence", () => {
  it("reports missing_gl when paid without a batch", () => {
    const [row] = run([payment({ batch_id: null })], new Map());
    expect(row.matchStatus).toBe("missing_gl");
  });

  it("reports unbalanced batches before account checks", () => {
    const txns = new Map<string, any[]>([
      [
        "batch-1",
        [
          { account_id: ACC.bnpl.id, debit: 600, credit: 0, is_voided: false, transaction_date: "2026-06-01" },
          { account_id: ACC.cash.id, debit: 0, credit: 500, is_voided: false, transaction_date: "2026-06-01" },
        ],
      ],
    ]);
    const [row] = run([payment()], txns);
    expect(row.matchStatus).toBe("unbalanced");
  });

  it("reports amount_mismatch when the movement differs from the amount received", () => {
    const [row] = run([payment({ paid_amount: 700 })], batch(ACC.bank.id, 600));
    expect(row.matchStatus).toBe("amount_mismatch");
    expect(row.difference).toBe(100);
  });

  it("reports voided payments", () => {
    const [row] = run([payment({ voided_at: "2026-06-05" })], batch(ACC.bank.id));
    expect(row.matchStatus).toBe("voided");
  });

  it("reports overdue and upcoming unpaid installments", () => {
    const [overdue] = run([payment({ status: "pending", paid_amount: 0, batch_id: null })], new Map());
    expect(overdue.matchStatus).toBe("overdue");
    expect(overdue.daysOverdue).toBe(9);

    const [upcoming] = run(
      [payment({ status: "pending", paid_amount: 0, batch_id: null, due_date: "2026-07-01" })],
      new Map(),
    );
    expect(upcoming.matchStatus).toBe("upcoming");
    expect(upcoming.daysOverdue).toBe(0);
  });
});

describe("computeReconTotals", () => {
  it("aggregates scheduled, received, movements and mismatch counts", () => {
    const rows = run(
      [
        payment(),
        payment({ id: "pay-2", payment_account_id: ACC.cash.id }),
        payment({ id: "pay-3", status: "pending", paid_amount: 0, batch_id: null }),
      ],
      batch(ACC.bank.id),
    );
    const totals = computeReconTotals(rows);
    expect(totals.scheduled).toBe(1800);
    expect(totals.received).toBe(1200);
    expect(totals.movements).toBe(1200);
    expect(totals.overdue).toBe(600);
    expect(totals.mismatched).toBe(1);
    expect(totals.unmatchedDelta).toBe(0);
  });
});

describe("defensive mapping guard", () => {
  const acc = (id: string, code: string, type = "asset") => ({
    id,
    account_code: code,
    account_name: `Acct ${code}`,
    account_type: type,
  });
  const accById = new Map<string, any>([
    [ "coa-equity", acc("coa-equity", "3401", "equity") ],
    [ "coa-bnpl", acc("coa-bnpl", "2450", "liability") ],
  ]);
  const basePayment = {
    id: "pay-1",
    plan_id: "plan-1",
    installment_no: 1,
    due_date: "2026-01-01",
    amount: 100,
    paid_amount: 100,
    status: "paid",
    funding_source: "partner",
    capital_account_id: "cap-1",
    batch_id: "b1",
  };
  const txns = new Map<string, any[]>([
    [
      "b1",
      [
        { account_id: "coa-bnpl", debit: 100, credit: 0, is_voided: false, transaction_date: "2026-01-01" },
        { account_id: "coa-equity", debit: 0, credit: 100, is_voided: false, transaction_date: "2026-01-01" },
      ],
    ],
  ]);

  it("blocks comparison when the resolved id is a partner capital record id", () => {
    const [row] = buildInstallmentReconRows({
      payments: [basePayment],
      planById: new Map(),
      txnsByBatch: txns,
      accById,
      // mis-mapped: capital record id returned instead of equity account id
      equityByCapitalId: new Map([["cap-1", "cap-1"]]),
      capitalRecordIds: new Set(["cap-1"]),
      today: "2026-02-01",
    });
    expect(row.explanation.mappingGuard.safe).toBe(false);
    expect(row.explanation.mappingGuard.reason).toBe("partner_record_id");
    expect(row.matchStatus).not.toBe("account_mismatch");
    expect(row.expected_credit_account_id).toBeNull();
  });

  it("blocks comparison when the resolved id is absent from the chart of accounts", () => {
    const [row] = buildInstallmentReconRows({
      payments: [basePayment],
      planById: new Map(),
      txnsByBatch: txns,
      accById,
      equityByCapitalId: new Map([["cap-1", "ghost-id"]]),
      capitalRecordIds: new Set(["cap-1"]),
      today: "2026-02-01",
    });
    expect(row.explanation.mappingGuard.reason).toBe("not_in_chart_of_accounts");
    expect(row.matchStatus).toBe("matched");
  });

  it("allows comparison for a properly resolved equity account", () => {
    const [row] = buildInstallmentReconRows({
      payments: [basePayment],
      planById: new Map(),
      txnsByBatch: txns,
      accById,
      equityByCapitalId: new Map([["cap-1", "coa-equity"]]),
      capitalRecordIds: new Set(["cap-1"]),
      today: "2026-02-01",
    });
    expect(row.explanation.mappingGuard.safe).toBe(true);
    expect(row.matchStatus).toBe("matched");
    expect(row.expected_credit_account_id).toBe("coa-equity");
  });

  it("checkExpectedAccountMapping returns not_resolved for null", () => {
    expect(checkExpectedAccountMapping(null, accById).reason).toBe("not_resolved");
  });
});
