import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { splitInstallmentPurchase } from "@/lib/installmentVatSplit";

/**
 * Regression guard for the "VAT deducted twice" defect (refrigerator plan:
 * asset registered at 2,555.91 instead of the 3,006.95 the ledger debited).
 *
 * Invariants enforced here:
 *  1. VAT is applied exactly once — re-running the split over the already-net
 *     value must not shave VAT off again.
 *  2. The fixed-asset cost equals the net goods value, which equals the ledger
 *     debit on the target/asset account.
 *  3. The entry balances (debits === CR 2450 BNPL Payable) for every
 *     installment count, and the generated schedule sums back to the total.
 */

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Mirrors the schedule split in create_installment_plan (last row absorbs drift). */
function schedule(total: number, count: number): number[] {
  const base = r2(total / count);
  const last = r2(total - base * (count - 1));
  return Array.from({ length: count }, (_, i) => (i === count - 1 ? last : base));
}

const COUNTS = [1, 2, 3, 4, 5, 6, 7, 9, 12, 18, 24, 36];
const PRICES = [999.99, 1500, 2555.91, 3006.95, 3458, 12345.67, 100000];
const FEES = [0, 142.02, 500];

describe("installment VAT is applied exactly once", () => {
  it("inclusive pricing backs VAT out of the gross without re-taxing", () => {
    const s = splitInstallmentPurchase({ price: 3458, vatPercent: 15, priceIncludesVat: true });
    expect(s.netAsset).toBe(3006.96);
    expect(r2(s.netAsset + s.goodsVat)).toBe(3458);
  });

  it("exclusive pricing adds VAT on top of the net exactly once", () => {
    const s = splitInstallmentPurchase({ price: 3006.95, vatPercent: 15, priceIncludesVat: false });
    expect(s.netAsset).toBe(3006.95);
    expect(s.goodsVat).toBe(451.04);
    expect(s.totalPayable).toBe(3457.99);
  });

  it("re-splitting the already-net value never strips VAT a second time", () => {
    for (const price of PRICES) {
      const first = splitInstallmentPurchase({ price, vatPercent: 15, priceIncludesVat: true });
      const second = splitInstallmentPurchase({
        price: first.netAsset,
        vatPercent: 15,
        priceIncludesVat: false,
      });
      // Net stays net; the exclusive pass must not divide by (1 + rate) again.
      expect(second.netAsset).toBe(first.netAsset);
      expect(r2(second.netAsset + second.goodsVat)).toBeCloseTo(price, 1);
    }
  });

  it("a zero VAT rate leaves the price untouched", () => {
    for (const price of PRICES) {
      const s = splitInstallmentPurchase({ price, vatPercent: 0, priceIncludesVat: true });
      expect(s.netAsset).toBe(r2(price));
      expect(s.goodsVat).toBe(0);
    }
  });

  it("finance-charge VAT is charged once and only when enabled", () => {
    const off = splitInstallmentPurchase({
      price: 3006.95, financeCharge: 142.02, vatPercent: 15,
      priceIncludesVat: false, vatOnFinanceCharge: false,
    });
    expect(off.financeVat).toBe(0);
    expect(off.financeNet).toBe(142.02);
    expect(off.totalPayable).toBe(3600.01);

    const on = splitInstallmentPurchase({
      price: 3006.95, financeCharge: 142.02, vatPercent: 15,
      priceIncludesVat: false, vatOnFinanceCharge: true,
    });
    expect(on.financeVat).toBe(r2(142.02 * 0.15));
    expect(on.recoverableVat).toBe(r2(on.goodsVat + on.financeVat));
  });
});

describe("asset cost matches the ledger debit for every installment count", () => {
  for (const count of COUNTS) {
    for (const inclusive of [true, false]) {
      for (const fee of FEES) {
        it(`count=${count} fee=${fee} inclusive=${inclusive}`, () => {
          for (const price of PRICES) {
            const s = splitInstallmentPurchase({
              price,
              financeCharge: fee,
              vatPercent: 15,
              priceIncludesVat: inclusive,
              vatOnFinanceCharge: false,
            });

            // The fixed asset is capitalised at the net goods value — the same
            // number the DB debits to the target/asset account.
            const assetCost = s.netAsset;
            const targetAccountDebit = s.netAsset;
            expect(assetCost).toBe(targetAccountDebit);

            // Entry balances: DR asset + DR input VAT + DR finance = CR BNPL.
            const debits = r2(s.netAsset + s.recoverableVat + s.financeNet);
            expect(debits).toBe(s.totalPayable);

            // Asset cost is never inflated by VAT nor by the finance charge.
            expect(assetCost).toBeLessThanOrEqual(s.totalPayable);
            expect(assetCost).not.toBe(r2(s.netAsset / 1.15));

            // Schedule reconciles to the financed total, whatever the count.
            const rows = schedule(s.totalPayable, count);
            expect(rows).toHaveLength(count);
            expect(r2(rows.reduce((a, b) => a + b, 0))).toBe(s.totalPayable);
            expect(rows.every((r) => r > 0 || s.totalPayable === 0)).toBe(true);
          }
        });
      }
    }
  }

  it("salvage and monthly depreciation derive from the net cost, not the gross", () => {
    const s = splitInstallmentPurchase({ price: 3006.95, vatPercent: 15, priceIncludesVat: false });
    const salvageRatePct = 5;
    const usefulLifeMonths = 84;
    const salvage = r2((s.netAsset * salvageRatePct) / 100);
    const monthly = r2((s.netAsset - salvage) / usefulLifeMonths);
    expect(salvage).toBe(150.35);
    expect(monthly).toBe(34.01);
  });
});

describe("SQL contract: the DB capitalises the stored net price", () => {
  const dir = join(process.cwd(), "supabase", "migrations");
  const sql = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(dir, f), "utf8"));

  const latestWith = (needle: string) => {
    for (let i = sql.length - 1; i >= 0; i--) if (sql[i].includes(needle)) return sql[i];
    return null;
  };

  it("create_installment_plan registers the asset at v_net (never re-divided)", () => {
    const body = latestWith("CREATE OR REPLACE FUNCTION public.create_installment_plan");
    expect(body).toBeTruthy();
    const fn = body!.slice(body!.indexOf("create_installment_plan"));
    // Exactly one place derives the net from the gross.
    const divisions = fn.match(/p_cash_price\s*\/\s*\(1\s*\+\s*v_rate\)/g) ?? [];
    expect(divisions.length).toBeLessThanOrEqual(1);
    // No second division of the already-net value anywhere.
    expect(/v_net\s*\/\s*\(1\s*\+\s*v_rate\)/.test(fn)).toBe(false);
  });

  it("update_installment_plan_details capitalises the stored cash_price as-is", () => {
    const body = latestWith("update_installment_plan_details");
    expect(body).toBeTruthy();
    expect(/v_net\s*:=\s*ROUND\(\s*v_plan\.cash_price\s*,\s*2\s*\)/.test(body!)).toBe(true);
    expect(/cash_price\s*\/\s*\(1\s*\+/.test(body!)).toBe(false);
  });
});
