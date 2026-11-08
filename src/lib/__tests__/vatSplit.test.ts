import { describe, expect, it } from "vitest";
import { splitVat, validateVatSplit, VAT_ACCOUNT_CODES } from "../vatSplit";

describe("splitVat", () => {
  it("splits a VAT-inclusive amount", () => {
    const s = splitVat({ amount: 115, ratePercent: 15, inclusive: true, vatEnabled: true });
    expect(s.net).toBe(100);
    expect(s.vat).toBe(15);
    expect(s.gross).toBe(115);
  });

  it("grosses up a VAT-exclusive amount", () => {
    const s = splitVat({ amount: 100, ratePercent: 15, inclusive: false, vatEnabled: true });
    expect(s.net).toBe(100);
    expect(s.vat).toBe(15);
    expect(s.gross).toBe(115);
  });

  it("keeps net + vat exactly equal to gross when rounding", () => {
    const s = splitVat({ amount: 3006.95, ratePercent: 15, inclusive: true, vatEnabled: true });
    expect(Number((s.net + s.vat).toFixed(2))).toBe(s.gross);
  });

  it("is a no-op when VAT is disabled or zero-rated", () => {
    expect(splitVat({ amount: 500, ratePercent: 15, inclusive: true, vatEnabled: false }).vat).toBe(0);
    expect(splitVat({ amount: 500, ratePercent: 0, inclusive: true, vatEnabled: true }).net).toBe(500);
  });

  it("validates the split", () => {
    expect(validateVatSplit(splitVat({ amount: 115, ratePercent: 15, inclusive: true }))).toBeNull();
    expect(validateVatSplit({ net: 0, vat: -1, gross: 0, ratePercent: 15 })).toMatch(/negative/i);
    expect(validateVatSplit({ net: 0, vat: 50, gross: 10, ratePercent: 15 })).toMatch(/larger/i);
  });

  it("maps to the correct VAT accounts", () => {
    expect(VAT_ACCOUNT_CODES.input).toBe("1180");
    expect(VAT_ACCOUNT_CODES.output).toBe("2200");
  });
});
