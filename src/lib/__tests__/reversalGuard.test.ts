import { describe, it, expect } from "vitest";
import { evaluateReversalEligibility, formatReversalBlockToast } from "@/lib/reversalGuard";

describe("evaluateReversalEligibility", () => {
  it("allows reversing an active posted document", () => {
    const s = evaluateReversalEligibility({ posted: true, originalTransactionId: "t1" });
    expect(s.allowed).toBe(true);
    expect(s.statusLabel).toBe("Active");
  });

  it("blocks when already reversed and reports when", () => {
    const s = evaluateReversalEligibility({
      posted: true,
      originalTransactionId: "t1",
      reversed: true,
      reversedAt: "2026-06-24T10:00:00Z",
      label: "advance",
    });
    expect(s.allowed).toBe(false);
    expect(s.code).toBe("ALREADY_REVERSED");
    expect(s.statusLabel).toMatch(/Reversed/);
  });

  it("blocks when the original is inactive/voided", () => {
    const s = evaluateReversalEligibility({ posted: true, originalTransactionId: "t1", inactive: true });
    expect(s.code).toBe("INACTIVE");
  });

  it("blocks when nothing was posted", () => {
    expect(evaluateReversalEligibility({ posted: false }).code).toBe("NOT_POSTED");
    expect(evaluateReversalEligibility({}).code).toBe("NOT_POSTED");
  });

  it("blocks when posted but the ledger link is missing", () => {
    const s = evaluateReversalEligibility({ posted: true, originalTransactionId: null });
    expect(s.code).toBe("MISSING_ORIGINAL");
  });

  it("already-reversed takes priority over inactive", () => {
    const s = evaluateReversalEligibility({ posted: true, originalTransactionId: "t", reversed: true, inactive: true });
    expect(s.code).toBe("ALREADY_REVERSED");
  });

  it("formats a toast with description and first hint", () => {
    const s = evaluateReversalEligibility({ posted: false, label: "payout" });
    const text = formatReversalBlockToast(s);
    expect(text).toContain("no journal entry");
    expect(text).toContain("Post the payout");
  });
});
