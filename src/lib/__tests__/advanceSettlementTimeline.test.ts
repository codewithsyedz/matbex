import { describe, it, expect } from "vitest";
import {
  buildAdvanceSettlementTimeline,
  timelineFinalBalance,
} from "@/lib/advanceSettlementTimeline";

const advance = {
  amount: 1000,
  created_at: "2026-01-01T10:00:00.000Z",
  status: "pending",
  staff: { name: "Ali" },
};

describe("buildAdvanceSettlementTimeline", () => {
  it("returns nothing without an advance", () => {
    expect(buildAdvanceSettlementTimeline({ advance: null })).toEqual([]);
  });

  it("tracks a running balance across repayments", () => {
    const events = buildAdvanceSettlementTimeline({
      advance,
      repayments: [
        { id: "r1", amount: 400, repayment_date: "2026-02-01", source: "cash", created_at: "2026-02-01T09:00:00.000Z" },
        { id: "r2", amount: 250, repayment_date: "2026-03-01", source: "payroll", created_at: "2026-03-01T09:00:00.000Z" },
      ],
    });
    expect(events.map((e) => e.kind)).toEqual(["recorded", "repayment", "repayment"]);
    expect(events[0].balance).toBe(1000);
    expect(events[1].balance).toBe(600);
    expect(timelineFinalBalance(events)).toBe(350);
  });

  it("marks ledger-linked repayments", () => {
    const events = buildAdvanceSettlementTimeline({
      advance,
      repayments: [
        { id: "r1", amount: 100, repayment_date: "2026-02-01", source: "cash", ledger_transaction_id: "t1" },
        { id: "r2", amount: 100, repayment_date: "2026-02-02", source: "payroll" },
      ],
    });
    expect(events[1].ledgerLinked).toBe(true);
    expect(events[2].ledgerLinked).toBe(false);
  });

  it("includes posting and reversal from ledger legs", () => {
    const events = buildAdvanceSettlementTimeline({
      advance: { ...advance, ledger_reversed: true, ledger_reversed_at: "2026-04-01T10:00:00.000Z" },
      legs: [
        { id: "l1", created_at: "2026-01-01T11:00:00.000Z", reference_type: "staff_advance", debit: 1000 },
        { id: "l2", created_at: "2026-04-01T10:00:00.000Z", reference_type: "staff_advance_reversal", credit: 1000 },
      ],
    });
    expect(events.map((e) => e.kind)).toEqual(["recorded", "posted", "reversal"]);
    expect(timelineFinalBalance(events)).toBe(0);
  });

  it("zeroes the balance when forgiven or deducted", () => {
    const forgiven = buildAdvanceSettlementTimeline({
      advance: { ...advance, status: "forgiven", updated_at: "2026-05-01T10:00:00.000Z" },
    });
    expect(timelineFinalBalance(forgiven)).toBe(0);

    const deducted = buildAdvanceSettlementTimeline({
      advance: { ...advance, deducted_at: "2026-05-02T10:00:00.000Z" },
    });
    expect(deducted.some((e) => e.kind === "deduction")).toBe(true);
    expect(timelineFinalBalance(deducted)).toBe(0);
  });

  it("appends audit log entries in order", () => {
    const events = buildAdvanceSettlementTimeline({
      advance,
      auditLogs: [{ id: "a1", action: "REVERSAL_POSTED", created_at: "2026-06-01T10:00:00.000Z" }],
    });
    expect(events[events.length - 1].title).toBe("Reversal posted");
  });
});
