/**
 * VAT-inclusive pricing regression suite.
 *
 * Guards the two surfaces that silently corrupt money when the pricing mode
 * math regresses:
 *   1. Sale notifications (the `notify_managers_on_sale` trigger) — managers
 *      must always see the VAT-inclusive amount the guest actually paid.
 *   2. Accounting journal entries — revenue must be posted NET, VAT posted to
 *      the VAT payable account, and the debit leg must equal the gross.
 *
 * The trigger and the ledger posting function live in SQL, so their arithmetic
 * is mirrored here by tiny pure functions built ONLY from the shared helpers in
 * `@/lib/vatInclusive`. If someone changes the helpers (or reintroduces
 * "add 15% on top of an inclusive price"), these tests fail.
 */
import { describe, it, expect } from "vitest";
import {
  VAT_RATE,
  roundMoney,
  splitListed,
  netFromListed,
  grossFromListed,
  normalizeSaleTotals,
  saleGrossTotal,
  sumMoney,
  formatMoneyAmount,
} from "@/lib/vatInclusive";
import { prepareSalesExportData } from "@/lib/exportUtils";
import { computeVatReturn, EMPTY_ADJUSTMENTS } from "@/lib/vatReturn";

type SaleRow = {
  subtotal: number | null;
  tax: number | null;
  total: number | null;
};

/** Mirror of `notify_managers_on_sale`: the amount shown in the toast. */
const notificationAmount = (sale: SaleRow, inclusive = true) =>
  saleGrossTotal(sale, VAT_RATE, inclusive);

/** Mirror of the sale -> ledger posting: DR cash / CR revenue + CR VAT. */
function saleJournalLegs(sale: SaleRow, inclusive = true) {
  const { gross, net, vat } = normalizeSaleTotals(sale, VAT_RATE, inclusive);
  return [
    { account: "1100 Cash", debit: gross, credit: 0 },
    { account: "4000 Sales Revenue", debit: 0, credit: net },
    { account: "2201 VAT Payable", debit: 0, credit: vat },
  ];
}

const legsBalance = (legs: ReturnType<typeof saleJournalLegs>) =>
  roundMoney(sumMoney(legs.map((l) => l.debit)) - sumMoney(legs.map((l) => l.credit)));

/** A listed 10.00 tea in an inclusive branch: guest pays exactly 10.00. */
const inclusiveSale: SaleRow = { subtotal: 8.7, tax: 1.3, total: 10 };
/** Same tea in an exclusive branch: 10.00 net + 1.50 VAT = 11.50 gross. */
const exclusiveSale: SaleRow = { subtotal: 10, tax: 1.5, total: 11.5 };
/** Row whose `tax` does not reconcile: the gross is re-split at the VAT rate. */
const inconsistentTax: SaleRow = { subtotal: 10, tax: 4, total: 10 };
/** Row saved without a tax breakdown: total is still the gross. */
const noTaxRecorded: SaleRow = { subtotal: 0, tax: 0, total: 11.5 };

describe("pricing mode math", () => {
  it("never adds VAT on top of an inclusive listed price", () => {
    const listed = 10;
    const { gross, net, vat } = splitListed(listed, VAT_RATE, true);
    expect(gross).toBe(listed);
    expect(roundMoney(net + vat)).toBe(listed);
    expect(net).toBeLessThan(listed);
    expect(grossFromListed(listed, VAT_RATE, true)).toBe(listed);
  });

  it("adds VAT on top only in exclusive mode", () => {
    const { gross, net, vat } = splitListed(10, VAT_RATE, false);
    expect(net).toBe(10);
    expect(vat).toBe(1.5);
    expect(gross).toBe(11.5);
    expect(netFromListed(10, VAT_RATE, false)).toBe(10);
  });

  it.each([0.5, 3.33, 10, 19.99, 127.45, 1234.56])(
    "keeps net + VAT === gross for %s",
    (listed) => {
      for (const inclusive of [true, false]) {
        const { gross, net, vat } = splitListed(listed, VAT_RATE, inclusive);
        expect(roundMoney(net + vat)).toBe(gross);
      }
    },
  );
});

describe("sale notifications show the VAT-inclusive amount", () => {
  it("uses the gross the guest paid in an inclusive branch", () => {
    expect(notificationAmount(inclusiveSale, true)).toBe(10);
  });

  it("uses the gross (net + VAT) in an exclusive branch", () => {
    expect(notificationAmount(exclusiveSale, false)).toBe(11.5);
  });

  it("treats `total` as the gross and never re-derives it from subtotal", () => {
    // Regression: an earlier heuristic rebuilt the gross from `subtotal`,
    // silently stripping the VAT off every correctly-saved inclusive sale.
    expect(notificationAmount(inclusiveSale, true)).toBe(Number(inclusiveSale.total));
    expect(notificationAmount(noTaxRecorded, true)).toBe(11.5);
  });

  it("re-splits the gross when the stored tax does not reconcile", () => {
    expect(notificationAmount(inconsistentTax, true)).toBe(10);
  });

  it("never reports more than the total for an inclusive sale", () => {
    const rows: SaleRow[] = [
      inclusiveSale,
      { subtotal: 43.48, tax: 6.52, total: 50 },
      { subtotal: 0, tax: 0, total: 25 },
    ];
    for (const row of rows) {
      expect(notificationAmount(row, true)).toBeLessThanOrEqual(
        Math.max(Number(row.total), Number(row.subtotal)),
      );
    }
  });

  it("formats the amount with exactly two decimals", () => {
    expect(formatMoneyAmount(notificationAmount(inclusiveSale))).toBe("10.00");
    expect(formatMoneyAmount(notificationAmount({ subtotal: 0, tax: 0, total: 1234.5 }))).toBe(
      "1,234.50",
    );
  });
});

describe("accounting journal entries", () => {
  it("posts revenue net and VAT separately, balanced to the gross", () => {
    const legs = saleJournalLegs(inclusiveSale, true);
    expect(legs[0].debit).toBe(10);
    expect(legs[1].credit).toBe(8.7);
    expect(legs[2].credit).toBe(1.3);
    expect(legsBalance(legs)).toBe(0);
  });

  it("never inflates revenue by re-adding VAT to an inclusive price", () => {
    const legs = saleJournalLegs(inclusiveSale, true);
    const revenue = legs[1].credit;
    expect(revenue).toBeLessThan(Number(inclusiveSale.total));
    expect(roundMoney(revenue * (1 + VAT_RATE))).toBeCloseTo(10, 1);
  });

  it("balances exclusive-branch sales at the gross, not the listed net", () => {
    const legs = saleJournalLegs(exclusiveSale, false);
    expect(legs[0].debit).toBe(11.5);
    expect(legs[1].credit).toBe(10);
    expect(legs[2].credit).toBe(1.5);
    expect(legsBalance(legs)).toBe(0);
  });

  it("balances rows saved without a tax breakdown by splitting the gross", () => {
    const legs = saleJournalLegs(noTaxRecorded, true);
    expect(legs[0].debit).toBe(11.5);
    expect(legs[1].credit).toBe(10);
    expect(legs[2].credit).toBe(1.5);
    expect(legsBalance(legs)).toBe(0);
  });

  it("keeps the ledger debit identical to the notification amount", () => {
    const rows: Array<[SaleRow, boolean]> = [
      [inclusiveSale, true],
      [exclusiveSale, false],
      [noTaxRecorded, true],
      [inconsistentTax, true],
      [{ subtotal: 0, tax: 0, total: 77.77 }, true],
    ];
    for (const [row, inclusive] of rows) {
      expect(saleJournalLegs(row, inclusive)[0].debit).toBe(
        notificationAmount(row, inclusive),
      );
    }
  });

  it("stays balanced across a full day of mixed sales", () => {
    const day: SaleRow[] = [
      inclusiveSale,
      noTaxRecorded,
      { subtotal: 26.09, tax: 3.91, total: 30 },
      { subtotal: 0, tax: 0, total: 15.75 },
    ];
    const legs = day.flatMap((s) => saleJournalLegs(s, true));
    expect(legsBalance(legs)).toBe(0);
    const debits = sumMoney(legs.filter((l) => l.debit).map((l) => l.debit));
    expect(debits).toBe(sumMoney(day.map((s) => notificationAmount(s, true))));
  });
});

describe("downstream reporting stays VAT-inclusive", () => {
  it("exports Net + VAT that reconcile to the inclusive total", () => {
    const { headers, rows } = prepareSalesExportData(
      [
        {
          created_at: "2026-08-01T09:00:00.000Z",
          receipt_number: "R-1",
          payment_method: "cash",
          branch_id: "b1",
          ...inclusiveSale,
        },
        {
          created_at: "2026-08-01T10:00:00.000Z",
          receipt_number: "R-2",
          payment_method: "card",
          branch_id: "b1",
          ...inclusiveSale,
        },
      ],
      0,
      "Aug-2026",
    );
    expect(headers).toContain("Total (incl. VAT)");
    expect(rows[0].slice(-3)).toEqual(["8.70", "1.30", "10.00"]);
    expect(rows[1].slice(-3)).toEqual(["8.70", "1.30", "10.00"]);
    // Summary row totals the normalized gross amounts.
    expect(rows[2].at(-1)).toBe("20.00");
  });

  it("reports VAT-inclusive sales correctly on the VAT return", () => {
    const result = computeVatReturn(
      [inclusiveSale, inclusiveSale],
      [],
      [],
      EMPTY_ADJUSTMENTS,
    );
    const box1 = result.sales.find((r) => r.key === "box1")!;
    expect(box1.amount).toBeCloseTo(17.4, 2);
    expect(roundMoney(box1.amount * VAT_RATE)).toBeCloseTo(2.6, 1);
  });
});
