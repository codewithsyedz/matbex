import { describe, expect, it } from "vitest";
import { receiptTotals } from "../receiptTotals";

describe("receiptTotals (printed receipt: Subtotal, Discount, VAT, Total)", () => {
  it("prices with VAT: a 3.00 discount on 23.00 prints 23.00 − 3.00 = 20.00 with VAT 2.61", () => {
    expect(receiptTotals({ linesListed: 23, documentDiscount: 3, vatRate: 0.15, pricesInclusive: true })).toEqual({
      subtotal: 23,
      discount: 3,
      tax: 2.61,
      total: 20,
    });
  });

  it("prices without VAT: VAT is added, and the discount row includes its VAT", () => {
    // Lines 100 net, discount 10 net → payable 90 net + 13.50 VAT = 103.50; discount row 11.50.
    expect(receiptTotals({ linesListed: 100, documentDiscount: 10, vatRate: 0.15, pricesInclusive: false })).toEqual({
      subtotal: 115,
      discount: 11.5,
      tax: 13.5,
      total: 103.5,
    });
  });

  it("no discount: no discount row, VAT shown, subtotal = total", () => {
    expect(receiptTotals({ linesListed: 46, vatRate: 0.15, pricesInclusive: true })).toEqual({ subtotal: 46, discount: null, tax: 6, total: 46 });
  });

  it("a surcharge is part of the subtotal", () => {
    const r = receiptTotals({ linesListed: 23, documentSurcharge: 2, vatRate: 0.15, pricesInclusive: true });
    expect(r).toEqual({ subtotal: 25, discount: null, tax: 3.26, total: 25 });
  });

  it("uses the recorded total and VAT when the sale was saved online; rows still add up", () => {
    const r = receiptTotals({ linesListed: 23, documentDiscount: 3, vatRate: 0.15, pricesInclusive: true, recorded: { tax: 2.61, total: 20 } });
    expect(r.total).toBe(20);
    expect(Math.round((r.subtotal - (r.discount ?? 0)) * 100) / 100).toBe(r.total);
  });
});

describe("the printed receipt shows them", () => {
  it("renders Subtotal 23.00, Discount 3.00, VAT 2.61 and Total 20.00", async () => {
    const { generateReceiptHTML } = await import("@/lib/printUtils");
    const html = await generateReceiptHTML({
      restaurantName: "QA",
      receiptNumber: "RCP-1",
      date: new Date("2026-11-23T18:00:00Z"),
      vatRatePercent: 15,
      pricesVatInclusive: true,
      items: [{ name: "Burger", quantity: 1, price: 23, total: 23 }],
      paymentMethod: "cash",
      language: "en",
      ...receiptTotals({ linesListed: 23, documentDiscount: 3, vatRate: 0.15, pricesInclusive: true }),
    });
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    expect(text).toMatch(/Subtotal [^0-9]*23\.00/);
    expect(text).toMatch(/Discount [^0-9]*3\.00/);
    expect(text).toMatch(/VAT \(15\.0%\) [^0-9]*2\.61/);
    expect(text).toMatch(/TOTAL [^0-9]*20\.00/);
  });
});
