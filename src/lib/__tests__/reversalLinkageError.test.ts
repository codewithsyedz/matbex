import { describe, it, expect } from "vitest";
import {
  parseReversalLinkageError,
  isReversalLinkageError,
  formatReversalLinkageToast,
} from "../reversalLinkageError";

const err = (message: string) => ({ message });

describe("parseReversalLinkageError", () => {
  it("ignores unrelated errors", () => {
    expect(parseReversalLinkageError(err("network timeout"))).toBeNull();
    expect(isReversalLinkageError("network timeout")).toBe(false);
  });

  it("maps a missing linkage", () => {
    const p = parseReversalLinkageError(
      err("REVERSAL_LINK_REQUIRED: a staff_advance_reversal line must reference the original transaction it reverses")
    )!;
    expect(p.code).toBe("link_required");
    expect(p.fixSteps.length).toBeGreaterThan(0);
  });

  it("maps a non-existent original", () => {
    const p = parseReversalLinkageError(
      err("REVERSAL_LINK_INVALID: original_transaction_id 123 does not exist")
    )!;
    expect(p.code).toBe("original_missing");
  });

  it("maps self-reference, reversal-of-reversal and type mismatch", () => {
    expect(
      parseReversalLinkageError(err("REVERSAL_LINK_INVALID: a transaction cannot reverse itself"))!.code
    ).toBe("self_reference");
    expect(
      parseReversalLinkageError(err("REVERSAL_LINK_INVALID: cannot reverse a reversal transaction"))!.code
    ).toBe("reverse_of_reversal");
    expect(
      parseReversalLinkageError(
        err("REVERSAL_LINK_INVALID: x must reverse a staff_advance transaction (found expense)")
      )!.code
    ).toBe("type_mismatch");
  });

  it("maps tenant, document, account and branch mismatches", () => {
    expect(
      parseReversalLinkageError(err("REVERSAL_LINK_INVALID: reversal tenant does not match the original transaction"))!
        .code
    ).toBe("tenant_mismatch");
    expect(
      parseReversalLinkageError(
        err("REVERSAL_LINK_INVALID: reversal must reference the same source document as the original")
      )!.code
    ).toBe("document_mismatch");
    expect(
      parseReversalLinkageError(
        err("REVERSAL_LINK_INVALID: reversal must post to the same account as the original")
      )!.code
    ).toBe("account_mismatch");
    expect(
      parseReversalLinkageError(
        err("REVERSAL_LINK_INVALID: reversal branch must match the original transaction branch")
      )!.code
    ).toBe("branch_mismatch");
  });

  it("maps mirror violations", () => {
    const p = parseReversalLinkageError(
      err("REVERSAL_MIRROR_INVALID: reversal must mirror the original (original DR 1000 / CR 0, reversal DR 0 / CR 600)")
    )!;
    expect(p.code).toBe("mirror_mismatch");
  });

  it("maps the duplicate-reversal unique index", () => {
    const p = parseReversalLinkageError(
      err('duplicate key value violates unique constraint "uq_active_reversal_per_original"')
    )!;
    expect(p.code).toBe("already_reversed");
  });

  it("builds a toast description containing the first fix step", () => {
    const p = parseReversalLinkageError(err("REVERSAL_LINK_REQUIRED: missing"))!;
    expect(formatReversalLinkageToast(p)).toContain(p.fixSteps[0]);
  });
});