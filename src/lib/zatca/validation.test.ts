import { describe, it, expect } from "vitest";
import {
  validateZatcaFields,
  type ZatcaValidationInput,
  type BuyerIdScheme,
} from "./validation";

const base: ZatcaValidationInput = {
  invoiceSubtype: "SIMPLIFIED",
  buyerName: "",
  buyerVat: "",
  buyerIdScheme: "CRN",
  buyerIdValue: "",
  docDiscount: "",
  docSurcharge: "",
  docCurrency: "SAR",
  docFxRate: "",
  cartTotal: 100,
};
const make = (o: Partial<ZatcaValidationInput> = {}) => ({ ...base, ...o });

// ---------------------------------------------------------------------
// Invoice subtype gating
// ---------------------------------------------------------------------
describe("validateZatcaFields - SIMPLIFIED (B2C) skips buyer checks", () => {
  it("returns no errors when buyer fields are empty", () => {
    expect(validateZatcaFields(make())).toEqual({});
  });

  it("ignores buyer name / VAT / ID for simplified invoices", () => {
    const errs = validateZatcaFields(
      make({ buyerName: "", buyerVat: "", buyerIdValue: "" }),
    );
    expect(errs.buyerName).toBeUndefined();
    expect(errs.buyerVat).toBeUndefined();
    expect(errs.buyerIdValue).toBeUndefined();
  });
});

// ---------------------------------------------------------------------
// Buyer name (STANDARD only)
// ---------------------------------------------------------------------
describe("validateZatcaFields - buyer name (STANDARD)", () => {
  it("requires a buyer name", () => {
    const errs = validateZatcaFields(
      make({ invoiceSubtype: "STANDARD", buyerVat: "300000000000003" }),
    );
    expect(errs.buyerName).toMatch(/required/i);
  });

  it("rejects names shorter than 3 characters", () => {
    const errs = validateZatcaFields(
      make({
        invoiceSubtype: "STANDARD",
        buyerName: "AB",
        buyerVat: "300000000000003",
      }),
    );
    expect(errs.buyerName).toMatch(/at least 3/);
  });

  it("accepts a valid name", () => {
    const errs = validateZatcaFields(
      make({
        invoiceSubtype: "STANDARD",
        buyerName: "Acme Trading Co.",
        buyerVat: "300000000000003",
      }),
    );
    expect(errs.buyerName).toBeUndefined();
  });
});

// ---------------------------------------------------------------------
// Buyer VAT
// ---------------------------------------------------------------------
describe("validateZatcaFields - buyer VAT (STANDARD)", () => {
  const std = (o: Partial<ZatcaValidationInput>) =>
    validateZatcaFields(
      make({ invoiceSubtype: "STANDARD", buyerName: "Acme LLC", ...o }),
    );

  it("requires VAT or non-VAT ID when both empty", () => {
    const errs = std({});
    expect(errs.buyerVat).toMatch(/15-digit VAT|non-VAT/);
    expect(errs.buyerIdValue).toMatch(/Required/);
  });

  it("rejects VAT with letters", () => {
    expect(std({ buyerVat: "30000000000000A" }).buyerVat).toMatch(
      /digits only/i,
    );
  });

  it("rejects VAT with wrong length", () => {
    expect(std({ buyerVat: "1234567890" }).buyerVat).toMatch(
      /exactly 15 digits.*you entered 10/,
    );
  });

  it("rejects VAT not starting/ending with 3", () => {
    expect(std({ buyerVat: "100000000000001" }).buyerVat).toMatch(
      /start and end with the digit 3/,
    );
  });

  it("accepts a well-formed VAT (no buyer ID needed)", () => {
    const errs = std({ buyerVat: "300000000000003" });
    expect(errs.buyerVat).toBeUndefined();
    expect(errs.buyerIdValue).toBeUndefined();
  });
});

// ---------------------------------------------------------------------
// Buyer ID scheme-specific rules
// ---------------------------------------------------------------------
describe("validateZatcaFields - buyer ID schemes (STANDARD)", () => {
  const idCase = (scheme: BuyerIdScheme, value: string) =>
    validateZatcaFields(
      make({
        invoiceSubtype: "STANDARD",
        buyerName: "Acme LLC",
        buyerIdScheme: scheme,
        buyerIdValue: value,
      }),
    ).buyerIdValue;

  it("rejects whitespace / punctuation in buyer ID", () => {
    expect(idCase("CRN", "12 34 56")).toMatch(/letters, digits, and hyphens/);
  });

  it("CRN: requires exactly 10 digits", () => {
    expect(idCase("CRN", "123456789")).toMatch(/CRN.*10 digits/);
    expect(idCase("CRN", "1234567890")).toBeUndefined();
  });

  it("NAT: 10 digits starting with 1", () => {
    expect(idCase("NAT", "2123456789")).toMatch(/National ID.*start with 1/);
    expect(idCase("NAT", "1234567890")).toBeUndefined();
  });

  it("IQA: 10 digits starting with 2", () => {
    expect(idCase("IQA", "1234567890")).toMatch(/Iqama.*start with 2/);
    expect(idCase("IQA", "2234567890")).toBeUndefined();
  });

  it("GCC: 8–15 digits", () => {
    expect(idCase("GCC", "1234567")).toMatch(/8–15 digits/);
    expect(idCase("GCC", "12345678")).toBeUndefined();
    expect(idCase("GCC", "123456789012345")).toBeUndefined();
    expect(idCase("GCC", "1234567890123456")).toMatch(/8–15 digits/);
  });

  it("PAS: 6–12 alphanumerics, case-insensitive", () => {
    expect(idCase("PAS", "ABC12")).toMatch(/Passport.*6–12/);
    expect(idCase("PAS", "a1234567")).toBeUndefined();
    expect(idCase("PAS", "ABCDEFGHIJKLM")).toMatch(/Passport.*6–12/);
  });

  it("MOM/MLS/SAG: 4–20 letters/digits with hyphens", () => {
    expect(idCase("MOM", "ABC")).toMatch(/MOM license.*4–20/);
    expect(idCase("MLS", "MLS-12345")).toBeUndefined();
    expect(idCase("SAG", "SAG-001-A")).toBeUndefined();
  });

  it("OTH: at least 3 characters", () => {
    expect(idCase("OTH", "AB")).toMatch(/at least 3/);
    expect(idCase("OTH", "X-99")).toBeUndefined();
  });

  it("a valid scheme-matching ID clears the buyerVat 'either-or' error", () => {
    const errs = validateZatcaFields(
      make({
        invoiceSubtype: "STANDARD",
        buyerName: "Acme LLC",
        buyerIdScheme: "CRN",
        buyerIdValue: "1234567890",
      }),
    );
    expect(errs.buyerVat).toBeUndefined();
    expect(errs.buyerIdValue).toBeUndefined();
  });
});

// ---------------------------------------------------------------------
// Discount
// ---------------------------------------------------------------------
describe("validateZatcaFields - discount limits", () => {
  it("ignores empty discount field", () => {
    expect(validateZatcaFields(make({ docDiscount: "" })).docDiscount).toBeUndefined();
  });

  it("rejects non-numeric discount", () => {
    expect(validateZatcaFields(make({ docDiscount: "abc" })).docDiscount).toMatch(
      /must be a number/,
    );
  });

  it("rejects negative discount", () => {
    expect(
      validateZatcaFields(make({ docDiscount: "-5" })).docDiscount,
    ).toMatch(/zero or greater/);
  });

  it("rejects more than 2 decimal places", () => {
    expect(
      validateZatcaFields(make({ docDiscount: "12.505" })).docDiscount,
    ).toMatch(/2 decimal places/);
  });

  it("rejects discount exceeding cart subtotal", () => {
    expect(
      validateZatcaFields(make({ docDiscount: "150", cartTotal: 100 }))
        .docDiscount,
    ).toMatch(/cannot exceed the cart subtotal \(100.00 SAR\)/);
  });

  it("includes document currency in the cap message when set", () => {
    expect(
      validateZatcaFields(
        make({
          docDiscount: "150",
          cartTotal: 100,
          docCurrency: "USD",
          docFxRate: "3.75",
        }),
      ).docDiscount,
    ).toMatch(/100.00 USD/);
  });

  it("accepts a valid discount equal to subtotal", () => {
    expect(
      validateZatcaFields(make({ docDiscount: "100", cartTotal: 100 }))
        .docDiscount,
    ).toBeUndefined();
  });
});

// ---------------------------------------------------------------------
// Surcharge
// ---------------------------------------------------------------------
describe("validateZatcaFields - surcharge limits", () => {
  it("rejects negative surcharge", () => {
    expect(
      validateZatcaFields(make({ docSurcharge: "-1" })).docSurcharge,
    ).toMatch(/zero or greater/);
  });

  it("rejects more than 2 decimal places", () => {
    expect(
      validateZatcaFields(make({ docSurcharge: "7.255" })).docSurcharge,
    ).toMatch(/2 decimal places/);
  });

  it("has no upper cap (surcharge can exceed cart total)", () => {
    expect(
      validateZatcaFields(make({ docSurcharge: "9999.99", cartTotal: 100 }))
        .docSurcharge,
    ).toBeUndefined();
  });
});

// ---------------------------------------------------------------------
// Foreign currency / FX rate
// ---------------------------------------------------------------------
describe("validateZatcaFields - foreign currency FX rate", () => {
  it("does not require FX rate when currency is SAR", () => {
    expect(
      validateZatcaFields(make({ docCurrency: "SAR", docFxRate: "" })).docFxRate,
    ).toBeUndefined();
  });

  it("requires FX rate for non-SAR currency", () => {
    expect(
      validateZatcaFields(make({ docCurrency: "USD", docFxRate: "" })).docFxRate,
    ).toMatch(/Exchange rate is required.*USD/);
  });

  it("rejects non-numeric FX rate", () => {
    expect(
      validateZatcaFields(make({ docCurrency: "EUR", docFxRate: "x" })).docFxRate,
    ).toMatch(/must be a number/);
  });

  it("rejects zero or negative FX rate", () => {
    expect(
      validateZatcaFields(make({ docCurrency: "USD", docFxRate: "0" })).docFxRate,
    ).toMatch(/greater than zero/);
    expect(
      validateZatcaFields(make({ docCurrency: "USD", docFxRate: "-1" }))
        .docFxRate,
    ).toMatch(/greater than zero/);
  });

  it("rejects more than 5 decimal places", () => {
    expect(
      validateZatcaFields(make({ docCurrency: "USD", docFxRate: "3.755555" }))
        .docFxRate,
    ).toMatch(/5 decimal places/);
  });

  it("flags suspiciously high FX rate (> 1000)", () => {
    expect(
      validateZatcaFields(make({ docCurrency: "USD", docFxRate: "1001" }))
        .docFxRate,
    ).toMatch(/unusually high/);
  });

  it("accepts a typical SAR/USD rate", () => {
    expect(
      validateZatcaFields(make({ docCurrency: "USD", docFxRate: "3.75" }))
        .docFxRate,
    ).toBeUndefined();
  });
});

// ---------------------------------------------------------------------
// Cross-cutting: STANDARD invoice with everything valid
// ---------------------------------------------------------------------
describe("validateZatcaFields - fully valid STANDARD foreign-currency invoice", () => {
  it("returns no errors", () => {
    const errs = validateZatcaFields({
      invoiceSubtype: "STANDARD",
      buyerName: "Globex International",
      buyerVat: "",
      buyerIdScheme: "CRN",
      buyerIdValue: "1234567890",
      docDiscount: "10",
      docSurcharge: "5",
      docCurrency: "USD",
      docFxRate: "3.75",
      cartTotal: 200,
    });
    expect(errs).toEqual({});
  });
});