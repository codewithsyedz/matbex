import { describe, it, expect } from "vitest";
import {
  auditAdvancePostingStatus,
  type AdvanceLedgerLeg,
} from "@/lib/staffAdvanceReconciliation";

const leg = (over: Partial<AdvanceLedgerLeg>): AdvanceLedgerLeg => ({
  reference_id: "a1",
  reference_type: "staff_advance",
  debit: 0,
  credit: 0,
  is_voided: false,
  account_code: "1150",
  ...over,
});

describe("auditAdvancePostingStatus", () => {
  it("flags an advance marked unposted that has ledger legs", () => {
    const r = auditAdvancePostingStatus(
      [{ id: "a1", amount: 200, ledger_posted: false, status: "pending" }],
      [leg({ debit: 200 })]
    );
    expect(r.issues.map((i) => i.code)).toContain("posted_flag_missing");
    expect(r.criticalCount).toBe(1);
  });

  it("flags an advance marked posted with no ledger legs", () => {
    const r = auditAdvancePostingStatus(
      [{ id: "a1", amount: 200, ledger_posted: true, status: "pending" }],
      []
    );
    expect(r.issues.map((i) => i.code)).toEqual(["posted_flag_without_ledger"]);
  });

  it("flags a deducted advance with no recovery credit", () => {
    const r = auditAdvancePostingStatus(
      [{ id: "a1", amount: 200, ledger_posted: true, status: "deducted" }],
      [leg({ debit: 200 })]
    );
    expect(r.issues.map((i) => i.code)).toContain("recovered_without_ledger_recovery");
  });

  it("flags ledger recovery while the advance is still outstanding", () => {
    const r = auditAdvancePostingStatus(
      [{ id: "a1", amount: 200, ledger_posted: true, status: "pending", repaid_amount: 0 }],
      [leg({ debit: 200 }), leg({ reference_type: "staff_advance_repayment", credit: 200 })]
    );
    expect(r.issues.map((i) => i.code)).toEqual(["ledger_recovery_without_status"]);
  });

  it("flags reversed advances without reversal legs", () => {
    const r = auditAdvancePostingStatus(
      [{ id: "a1", amount: 200, ledger_posted: true, ledger_reversed: true, status: "pending" }],
      [leg({ debit: 200 })]
    );
    expect(r.issues.map((i) => i.code)).toContain("reversed_flag_missing");
  });

  it("is clean for a consistent posted + fully recovered advance", () => {
    const r = auditAdvancePostingStatus(
      [
        {
          id: "a1",
          amount: 200,
          ledger_posted: true,
          status: "deducted",
          repaid_amount: 200,
        },
      ],
      [leg({ debit: 200 }), leg({ reference_type: "advance_deduction", credit: 200 })]
    );
    expect(r.clean).toBe(true);
    expect(r.cleanCount).toBe(1);
  });

  it("ignores voided legs and non-1150 accounts", () => {
    const r = auditAdvancePostingStatus(
      [{ id: "a1", amount: 200, ledger_posted: false, status: "pending" }],
      [leg({ debit: 200, is_voided: true }), leg({ debit: 200, account_code: "1000" })]
    );
    expect(r.clean).toBe(true);
  });
});
