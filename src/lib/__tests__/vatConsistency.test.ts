import { describe, expect, it } from "vitest";
import { splitVat, validateVatConsistency } from "@/lib/vatSplit";

const check = (o: Parameters<typeof validateVatConsistency>[0]) =>
  validateVatConsistency(o).issues.map((i) => i.code);

describe("validateVatConsistency", () => {
  it("passes for a clean 15% inclusive split", () => {
    const split = splitVat({ amount: 115, ratePercent: 15, inclusive: true });
    const res = validateVatConsistency({
      split,
      ratePercent: 15,
      enteredAmount: 115,
      inclusive: true,
      branchRatePercent: 15,
    });
    expect(res.valid).toBe(true);
    expect(res.issues).toHaveLength(0);
  });

  it("passes for a clean 15% exclusive split", () => {
    const split = splitVat({ amount: 100, ratePercent: 15, inclusive: false });
    expect(
      validateVatConsistency({
        split,
        ratePercent: 15,
        enteredAmount: 100,
        inclusive: false,
        branchRatePercent: 15,
      }).valid,
    ).toBe(true);
  });

  it("flags a missing or zero rate", () => {
    const split = splitVat({ amount: 100, ratePercent: 0, inclusive: true });
    expect(
      check({ split, ratePercent: "", enteredAmount: 100, inclusive: true }),
    ).toContain("rate_missing");
  });

  it("flags an out-of-range rate", () => {
    const split = splitVat({ amount: 100, ratePercent: 150, inclusive: true });
    expect(
      check({ split, ratePercent: 150, enteredAmount: 100, inclusive: true }),
    ).toContain("rate_out_of_range");
  });

  it("warns when the rate differs from the branch rate", () => {
    const split = splitVat({ amount: 105, ratePercent: 5, inclusive: true });
    const res = validateVatConsistency({
      split,
      ratePercent: 5,
      enteredAmount: 105,
      inclusive: true,
      branchRatePercent: 15,
    });
    expect(res.valid).toBe(true);
    expect(res.warnings.map((w) => w.code)).toEqual(["rate_branch_mismatch"]);
  });

  it("errors when the split total does not match the expense amount", () => {
    const split = splitVat({ amount: 115, ratePercent: 15, inclusive: true });
    expect(
      check({ split, ratePercent: 15, enteredAmount: 200, inclusive: true }),
    ).toContain("gross_mismatch");
  });

  it("errors when VAT does not match the rate applied to net", () => {
    const split = { net: 100, vat: 30, gross: 130, ratePercent: 15 };
    expect(
      check({ split, ratePercent: 15, enteredAmount: 130, inclusive: true }),
    ).toContain("rate_amount_mismatch");
  });

  it("errors when the legs do not balance", () => {
    const split = { net: 100, vat: 15, gross: 120, ratePercent: 15 };
    const codes = check({
      split,
      ratePercent: 15,
      enteredAmount: 120,
      inclusive: true,
    });
    expect(codes).toContain("legs_do_not_balance");
  });

  it("errors on negative VAT", () => {
    const split = { net: 110, vat: -10, gross: 100, ratePercent: 15 };
    expect(
      check({ split, ratePercent: 15, enteredAmount: 100, inclusive: true }),
    ).toContain("vat_negative");
  });

  it("tolerates halala rounding on odd amounts", () => {
    const split = splitVat({ amount: 33.33, ratePercent: 15, inclusive: true });
    expect(
      validateVatConsistency({
        split,
        ratePercent: 15,
        enteredAmount: 33.33,
        inclusive: true,
        branchRatePercent: 15,
      }).valid,
    ).toBe(true);
  });
});
