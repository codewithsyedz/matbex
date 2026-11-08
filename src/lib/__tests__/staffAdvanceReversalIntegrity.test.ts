import { describe, it, expect } from "vitest";
import {
  auditAdvanceReversalIntegrity,
  type AdvanceLedgerLeg,
  type AdvanceSourceRow,
} from "../staffAdvanceReconciliation";

const leg = (o: Partial<AdvanceLedgerLeg>): AdvanceLedgerLeg => ({
  reference_id: "a1",
  reference_type: "staff_advance",
  account_code: "1150",
  debit: 0,
  credit: 0,
  is_voided: false,
  ...o,
});

const advance = (o: Partial<AdvanceSourceRow>): AdvanceSourceRow => ({
  id: "a1",
  amount: 1000,
  ledger_posted: true,
  ledger_reversed: true,
  ...o,
});

describe("auditAdvanceReversalIntegrity", () => {
  it("passes a perfectly mirrored reversal", () => {
    const res = auditAdvanceReversalIntegrity(
      [advance({})],
      [
        leg({ debit: 1000 }),
        leg({ reference_type: "staff_advance_reversal", credit: 1000 }),
      ]
    );
    expect(res.clean).toBe(true);
    expect(res.balancedCount).toBe(1);
    expect(res.checkedCount).toBe(1);
  });

  it("flags amount mismatch when reversal is partial", () => {
    const res = auditAdvanceReversalIntegrity(
      [advance({})],
      [
        leg({ debit: 1000 }),
        leg({ reference_type: "staff_advance_reversal", credit: 600 }),
      ]
    );
    expect(res.clean).toBe(false);
    expect(res.issues[0].code).toBe("amount_mismatch");
    expect(res.issues[0].netEffect).toBe(400);
  });

  it("flags missing reversal legs", () => {
    const res = auditAdvanceReversalIntegrity([advance({})], [leg({ debit: 1000 })]);
    expect(res.issues[0].code).toBe("missing_reversal");
  });

  it("flags orphan reversal legs with no original", () => {
    const res = auditAdvanceReversalIntegrity(
      [],
      [leg({ reference_type: "staff_advance_reversal", credit: 1000 })]
    );
    expect(res.issues[0].code).toBe("orphan_reversal");
  });

  it("ignores voided legs and non-1150 accounts", () => {
    const res = auditAdvanceReversalIntegrity(
      [advance({})],
      [
        leg({ debit: 1000 }),
        leg({ debit: 500, is_voided: true }),
        leg({ account_code: "1000", credit: 1000 }),
        leg({ reference_type: "staff_advance_reversal", credit: 1000 }),
      ]
    );
    expect(res.clean).toBe(true);
  });

  it("does not check advances that were never reversed", () => {
    const res = auditAdvanceReversalIntegrity(
      [advance({ ledger_reversed: false })],
      [leg({ debit: 1000 })]
    );
    expect(res.checkedCount).toBe(0);
    expect(res.clean).toBe(true);
  });

  it("tolerates sub-cent rounding drift", () => {
    const res = auditAdvanceReversalIntegrity(
      [advance({})],
      [
        leg({ debit: 1000 }),
        leg({ reference_type: "staff_advance_reversal", credit: 1000.01 }),
      ]
    );
    expect(res.clean).toBe(true);
  });
});
