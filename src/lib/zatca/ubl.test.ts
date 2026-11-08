import { describe, it, expect } from "vitest";
import {
  buildSimplifiedTaxInvoiceUbl,
  type BuildUblInput,
  type UblLine,
  type DocumentAllowanceCharge,
} from "./ubl";

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------
const baseSeller = {
  nameEn: "Test Restaurant",
  vatNumber: "300000000000003",
  crNumber: "1010101010",
  addressLine: "King Fahd Rd",
  city: "Riyadh",
  countryCode: "SA",
};

function line(unit: number, qty = 1): UblLine {
  const ext = unit * qty;
  return {
    name: "Item",
    quantity: qty,
    unitPrice: unit,
    lineExtension: ext,
    taxAmount: ext * 0.15,
    vatCategory: "S",
  };
}

function makeInput(overrides: Partial<BuildUblInput> = {}): BuildUblInput {
  const lines = overrides.lines ?? [line(100)];
  const subtotal = lines.reduce((s, l) => s + l.lineExtension, 0);
  const acs = overrides.allowanceCharges ?? [];
  const allowance = acs.filter((a) => !a.isCharge).reduce((s, a) => s + a.amount, 0);
  const charge = acs.filter((a) => a.isCharge).reduce((s, a) => s + a.amount, 0);
  const taxable = subtotal - allowance + charge;
  const tax = taxable * 0.15;
  return {
    uuid: "00000000-0000-0000-0000-000000000000",
    receiptNumber: "TEST-1",
    issueDateTime: "2026-05-08T12:00:00.000Z",
    icv: 1,
    pih: "0",
    qrBase64: null,
    seller: baseSeller,
    invoiceSubtype: "SIMPLIFIED",
    currency: "SAR",
    lines,
    taxExclusiveAmount: subtotal,
    taxAmount: tax,
    taxInclusiveAmount: taxable + tax,
    ...overrides,
  };
}

/** Extract first matching numeric value from XML by tag. */
function getNum(xml: string, tag: string): number {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`));
  if (!m) throw new Error(`Tag ${tag} not found`);
  return Number(m[1]);
}
function getAll(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`, "g");
  return Array.from(xml.matchAll(re)).map((m) => m[1]);
}

// ---------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------
describe("buildSimplifiedTaxInvoiceUbl - totals", () => {
  it("computes 15% VAT and inclusive total for a plain invoice", () => {
    const xml = buildSimplifiedTaxInvoiceUbl(makeInput({ lines: [line(100)] }));
    expect(getNum(xml, "cbc:LineExtensionAmount")).toBe(100);
    expect(getNum(xml, "cbc:TaxExclusiveAmount")).toBe(100);
    expect(getNum(xml, "cbc:TaxInclusiveAmount")).toBe(115);
    expect(getNum(xml, "cbc:PayableAmount")).toBe(115);
    // Document-level TaxAmount (first occurrence is line tax, find doc-level)
    const taxAmounts = getAll(xml, "cbc:TaxAmount");
    expect(taxAmounts.map(Number)).toContain(15);
  });

  it("aggregates multiple lines into correct totals", () => {
    const xml = buildSimplifiedTaxInvoiceUbl(
      makeInput({ lines: [line(50, 2), line(30, 1)] }),
    );
    // 50*2 + 30 = 130 → VAT 19.50 → 149.50
    expect(getNum(xml, "cbc:LineExtensionAmount")).toBe(130);
    expect(getNum(xml, "cbc:TaxInclusiveAmount")).toBe(149.5);
  });
});

describe("buildSimplifiedTaxInvoiceUbl - discounts (AllowanceCharge)", () => {
  it("reduces VAT base when a document-level discount is applied", () => {
    const ac: DocumentAllowanceCharge = {
      isCharge: false,
      amount: 20,
      reason: "Promo",
      vatCategory: "S",
    };
    const xml = buildSimplifiedTaxInvoiceUbl(
      makeInput({ lines: [line(100)], allowanceCharges: [ac] }),
    );
    // Base 100 - 20 = 80 → VAT 12 → 92
    expect(getNum(xml, "cbc:TaxExclusiveAmount")).toBe(80);
    expect(getNum(xml, "cbc:TaxInclusiveAmount")).toBe(92);
    expect(getNum(xml, "cbc:AllowanceTotalAmount")).toBe(20);
    // TaxSubtotal taxable amount reflects discount
    const taxable = getAll(xml, "cbc:TaxableAmount").map(Number);
    expect(taxable).toContain(80);
    // AllowanceCharge block emitted with chargeIndicator=false
    expect(xml).toContain("<cbc:ChargeIndicator>false</cbc:ChargeIndicator>");
  });
});

describe("buildSimplifiedTaxInvoiceUbl - surcharges (AllowanceCharge)", () => {
  it("increases VAT base when a document-level surcharge is applied", () => {
    const ac: DocumentAllowanceCharge = {
      isCharge: true,
      amount: 10,
      reason: "Service",
      vatCategory: "S",
    };
    const xml = buildSimplifiedTaxInvoiceUbl(
      makeInput({ lines: [line(100)], allowanceCharges: [ac] }),
    );
    // Base 100 + 10 = 110 → VAT 16.50 → 126.50
    expect(getNum(xml, "cbc:TaxExclusiveAmount")).toBe(110);
    expect(getNum(xml, "cbc:TaxInclusiveAmount")).toBe(126.5);
    expect(getNum(xml, "cbc:ChargeTotalAmount")).toBe(10);
    expect(xml).toContain("<cbc:ChargeIndicator>true</cbc:ChargeIndicator>");
  });

  it("nets discount and surcharge correctly in same invoice", () => {
    const acs: DocumentAllowanceCharge[] = [
      { isCharge: false, amount: 30, vatCategory: "S" },
      { isCharge: true, amount: 10, vatCategory: "S" },
    ];
    const xml = buildSimplifiedTaxInvoiceUbl(
      makeInput({ lines: [line(200)], allowanceCharges: acs }),
    );
    // 200 - 30 + 10 = 180 → VAT 27 → 207
    expect(getNum(xml, "cbc:TaxExclusiveAmount")).toBe(180);
    expect(getNum(xml, "cbc:TaxInclusiveAmount")).toBe(207);
    expect(getNum(xml, "cbc:AllowanceTotalAmount")).toBe(30);
    expect(getNum(xml, "cbc:ChargeTotalAmount")).toBe(10);
  });
});

describe("buildSimplifiedTaxInvoiceUbl - foreign currency / TaxExchangeRate", () => {
  it("emits TaxExchangeRate when document currency != tax currency", () => {
    const xml = buildSimplifiedTaxInvoiceUbl(
      makeInput({
        currency: "USD",
        taxCurrency: "SAR",
        taxExchangeRate: 3.75,
      }),
    );
    expect(xml).toContain("<cac:TaxExchangeRate>");
    expect(xml).toContain("<cbc:SourceCurrencyCode>USD</cbc:SourceCurrencyCode>");
    expect(xml).toContain("<cbc:TargetCurrencyCode>SAR</cbc:TargetCurrencyCode>");
    expect(xml).toContain("<cbc:CalculationRate>3.75000</cbc:CalculationRate>");
    expect(xml).toContain('currencyID="USD"');
  });

  it("omits TaxExchangeRate when currencies match (SAR-only invoice)", () => {
    const xml = buildSimplifiedTaxInvoiceUbl(makeInput());
    expect(xml).not.toContain("<cac:TaxExchangeRate>");
  });

  it("formats exchange rate to 5 decimal places", () => {
    const xml = buildSimplifiedTaxInvoiceUbl(
      makeInput({
        currency: "EUR",
        taxCurrency: "SAR",
        taxExchangeRate: 4.1,
      }),
    );
    expect(xml).toContain("<cbc:CalculationRate>4.10000</cbc:CalculationRate>");
  });
});

describe("buildSimplifiedTaxInvoiceUbl - payable rounding", () => {
  it("folds PayableRoundingAmount into PayableAmount", () => {
    const xml = buildSimplifiedTaxInvoiceUbl(
      makeInput({ payableRoundingAmount: 0.05 }),
    );
    expect(getNum(xml, "cbc:PayableRoundingAmount")).toBe(0.05);
    // 115 + 0.05 = 115.05
    expect(getNum(xml, "cbc:PayableAmount")).toBe(115.05);
  });
});

describe("buildSimplifiedTaxInvoiceUbl - money rounding (2 decimals)", () => {
  it("rounds amounts to 2 decimal places", () => {
    // 33.333 * 3 = 99.999 → VAT 14.99985 → 114.99885
    const l: UblLine = {
      name: "Item",
      quantity: 3,
      unitPrice: 33.333,
      lineExtension: 99.999,
      taxAmount: 99.999 * 0.15,
    };
    const xml = buildSimplifiedTaxInvoiceUbl(makeInput({ lines: [l] }));
    // toFixed(2) rounding: 99.999 → 100.00, VAT 15.00 → 115.00
    expect(xml).toContain("<cbc:LineExtensionAmount currencyID=\"SAR\">100.00</cbc:LineExtensionAmount>");
  });
});