/**
 * Regression suite: branch-wise DR=CR posting across payment lifecycle edge
 * cases — partial payments, partial refunds, chargebacks and long event chains.
 */
import { describe, it, expect } from "vitest";
import {
  buildPaymentEventLegs,
  buildEventSequenceLegs,
  buildExpensePostingLegs,
  outstandingAfterEvents,
  isBalanced,
  isBalancedPerBranch,
  branchTotals,
  type CoaAccount,
  type PaymentEvent,
} from "@/lib/expensePostingRouting";

const PARENT_EXPENSE = "acc-exp";
const PARENT_CASH = "acc-cash";
const PARENT_AP = "acc-ap";

const accounts: CoaAccount[] = [
  { id: PARENT_EXPENSE, account_code: "5000", account_name: "Food Cost", parent_id: null },
  { id: "exp-wadi", account_code: "5000-2", account_name: "Food Cost - Al-Wadi", parent_id: PARENT_EXPENSE },
  { id: PARENT_CASH, account_code: "1000", account_name: "Cash on Hand", parent_id: null },
  { id: "cash-wadi", account_code: "1000-2", account_name: "Cash on Hand - Al-Wadi", parent_id: PARENT_CASH },
  { id: PARENT_AP, account_code: "2000", account_name: "Accounts Payable", parent_id: null },
  { id: "ap-wadi", account_code: "2000-2", account_name: "Accounts Payable - Al-Wadi", parent_id: PARENT_AP },
];

const counterAccountIdByCode = { "1000": PARENT_CASH, "2000": PARENT_AP };

const wadi = {
  branchId: "branch-wadi",
  branchName: "Al-Wadi",
  expenseAccountId: PARENT_EXPENSE,
  counterAccountIdByCode,
  accounts,
};

const hq = { ...wadi, branchId: "branch-hq", branchName: "Riyadh HQ" };

describe("single payment events stay balanced and branch-routed", () => {
  it.each<PaymentEvent["kind"]>(["payment", "refund", "chargeback"])(
    "%s posts two balanced legs on the branch",
    (kind) => {
      const legs = buildPaymentEventLegs({
        ...wadi,
        againstPayable: true,
        event: { kind, amount: 250.75 },
      });
      expect(legs).toHaveLength(2);
      expect(isBalanced(legs)).toBe(true);
      expect(isBalancedPerBranch(legs)).toBe(true);
      expect(legs.every((l) => l.branchId === "branch-wadi")).toBe(true);
    },
  );

  it("routes both legs to branch sub-accounts when they exist", () => {
    const legs = buildPaymentEventLegs({
      ...wadi,
      againstPayable: true,
      event: { kind: "payment", amount: 100 },
    });
    expect(legs.map((l) => l.accountId).sort()).toEqual(["ap-wadi", "cash-wadi"]);
  });

  it("falls back to parent accounts for a branch without sub-accounts", () => {
    const legs = buildPaymentEventLegs({
      ...hq,
      againstPayable: true,
      event: { kind: "payment", amount: 100 },
    });
    expect(legs.map((l) => l.accountId).sort()).toEqual([PARENT_AP, PARENT_CASH]);
    expect(isBalanced(legs)).toBe(true);
  });

  it("normalises negative amounts instead of flipping the balance", () => {
    const legs = buildPaymentEventLegs({ ...wadi, event: { kind: "refund", amount: -80 } });
    expect(isBalanced(legs)).toBe(true);
    expect(legs.some((l) => l.debit === 80)).toBe(true);
    expect(legs.some((l) => l.credit === 80)).toBe(true);
  });

  it("directs a refund into cash and out of the expense account", () => {
    const [debit, credit] = buildPaymentEventLegs({
      ...wadi,
      event: { kind: "refund", amount: 40 },
    });
    expect(debit.accountId).toBe("cash-wadi");
    expect(credit.accountId).toBe("exp-wadi");
  });

  it("restores the payable on a chargeback", () => {
    const legs = buildPaymentEventLegs({ ...wadi, event: { kind: "chargeback", amount: 40 } });
    expect(legs.find((l) => l.credit)?.accountId).toBe("ap-wadi");
    expect(legs.find((l) => l.debit)?.accountId).toBe("cash-wadi");
  });
});

describe("multi-event sequences", () => {
  const original = 1000;

  it("keeps DR=CR across partial payments, a partial refund and a chargeback", () => {
    const events: PaymentEvent[] = [
      { kind: "payment", amount: 400 },
      { kind: "payment", amount: 300 },
      { kind: "refund", amount: 120.5 },
      { kind: "chargeback", amount: 300 },
      { kind: "payment", amount: 300 },
    ];
    const legs = buildEventSequenceLegs(events, { ...wadi, againstPayable: true });
    expect(legs).toHaveLength(events.length * 2);
    expect(isBalanced(legs)).toBe(true);
    expect(isBalancedPerBranch(legs)).toBe(true);
  });

  it("tracks outstanding balance through the same sequence", () => {
    expect(
      outstandingAfterEvents(original, [
        { kind: "payment", amount: 400 },
        { kind: "payment", amount: 300 },
        { kind: "chargeback", amount: 300 },
      ]),
    ).toBeCloseTo(600, 2);
  });

  it("handles full settlement in many small instalments without drift", () => {
    const events: PaymentEvent[] = Array.from({ length: 7 }, () => ({
      kind: "payment" as const,
      amount: 142.857,
    }));
    const legs = buildEventSequenceLegs(events, { ...wadi, againstPayable: true });
    expect(isBalanced(legs)).toBe(true);
    expect(outstandingAfterEvents(999.999, events)).toBeCloseTo(0, 2);
  });

  it("never mixes branches: each branch balances on its own", () => {
    const legs = [
      ...buildEventSequenceLegs(
        [
          { kind: "payment", amount: 200 },
          { kind: "refund", amount: 50 },
        ],
        { ...wadi, againstPayable: true },
      ),
      ...buildEventSequenceLegs([{ kind: "chargeback", amount: 75 }], {
        ...hq,
        againstPayable: true,
      }),
    ];
    const totals = branchTotals(legs);
    expect(Object.keys(totals).sort()).toEqual(["branch-hq", "branch-wadi"]);
    expect(isBalancedPerBranch(legs)).toBe(true);
    expect(totals["branch-wadi"].debit).toBeCloseTo(250, 2);
    expect(totals["branch-hq"].debit).toBeCloseTo(75, 2);
  });

  it("keeps the original expense posting balanced alongside its later events", () => {
    const posting = buildExpensePostingLegs({
      amount: 1000,
      status: "unpaid",
      branchId: wadi.branchId,
      branchName: wadi.branchName,
      debitAccountId: PARENT_EXPENSE,
      counterAccountIdByCode,
      accounts,
    });
    const all = [
      ...posting,
      ...buildEventSequenceLegs(
        [
          { kind: "payment", amount: 1000 },
          { kind: "chargeback", amount: 1000 },
          { kind: "payment", amount: 1000 },
        ],
        { ...wadi, againstPayable: true },
      ),
    ];
    expect(isBalanced(all)).toBe(true);
    expect(isBalancedPerBranch(all)).toBe(true);
  });

  it("tenant-wide (no branch) events still balance", () => {
    const legs = buildEventSequenceLegs(
      [
        { kind: "payment", amount: 90 },
        { kind: "refund", amount: 90 },
      ],
      { ...wadi, branchId: null, branchName: null, againstPayable: true },
    );
    expect(isBalancedPerBranch(legs)).toBe(true);
    expect(branchTotals(legs).__tenant__.debit).toBeCloseTo(180, 2);
  });
});
