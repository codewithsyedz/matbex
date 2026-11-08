import { describe, it, expect } from "vitest";
import { reconcileStaffAdvances } from "../staffAdvanceReconciliation";

const leg = (ref: string, debit = 0, credit = 0, extra = {}) => ({
  reference_id: ref,
  debit,
  credit,
  is_voided: false,
  account_code: "1150",
  ...extra,
});

describe("reconcileStaffAdvances", () => {
  it("matches when every posted advance has a DR 1150 leg", () => {
    const r = reconcileStaffAdvances(
      [
        { id: "a", amount: 50, ledger_posted: true },
        { id: "b", amount: 120.5, ledger_posted: true },
      ],
      [leg("a", 50), leg("b", 120.5)]
    );
    expect(r.sourceTotal).toBe(170.5);
    expect(r.ledgerTotal).toBe(170.5);
    expect(r.matched).toBe(true);
    expect(r.postedCount).toBe(2);
  });

  it("ignores voided legs and other accounts", () => {
    const r = reconcileStaffAdvances(
      [{ id: "a", amount: 50, ledger_posted: true }],
      [leg("a", 50), leg("a", 50, 0, { is_voided: true }), leg("a", 0, 50, { account_code: "1000" })]
    );
    expect(r.ledgerTotal).toBe(50);
    expect(r.matched).toBe(true);
  });

  it("nets reversals to zero and reports them separately", () => {
    const r = reconcileStaffAdvances(
      [{ id: "a", amount: 50, ledger_posted: true, ledger_reversed: true }],
      [leg("a", 50, 0, { is_voided: true }), leg("a", 0, 50)]
    );
    expect(r.reversedCount).toBe(1);
    expect(r.sourceTotal).toBe(0);
    expect(r.ledgerTotal).toBe(-50);
  });

  it("flags a gap when a posted advance has no ledger leg", () => {
    const r = reconcileStaffAdvances([{ id: "a", amount: 50, ledger_posted: true }], []);
    expect(r.matched).toBe(false);
    expect(r.difference).toBe(50);
    expect(r.rows[0].matched).toBe(false);
  });

  it("excludes unposted advances from the source total", () => {
    const r = reconcileStaffAdvances(
      [
        { id: "a", amount: 50, ledger_posted: true },
        { id: "b", amount: 30, ledger_posted: false },
      ],
      [leg("a", 50)]
    );
    expect(r.unpostedCount).toBe(1);
    expect(r.unpostedTotal).toBe(30);
    expect(r.matched).toBe(true);
  });
});
