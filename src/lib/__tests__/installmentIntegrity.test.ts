import { describe, it, expect } from "vitest";
import { checkInstallmentIntegrity, recalcSchedule } from "@/lib/installmentIntegrity";

const base = {
  cashPrice: 3006.95,
  currentFinanceCharge: 142.02,
  currentTotalPayable: 3600.01,
  vatAmount: 451.04,
  paidAmount: 600,
  paidCount: 1,
  nextFinanceCharge: 200,
  nextInstallmentCount: 6,
  ledger: { targetDebit: 3006.95, vatDebit: 451.04, financeDebit: 142.02, liabilityCredit: 3600.01 },
  assetCost: 3006.95,
  assetName: "Refrigerator",
};

describe("installment integrity validation", () => {
  it("passes when ledger, asset register and schedule agree", () => {
    const r = checkInstallmentIntegrity(base);
    expect(r.hasErrors).toBe(false);
    expect(r.revisedTotal).toBe(3657.99);
    expect(Math.round((r.scheduleRows.reduce((a, b) => a + b, 0) + 600) * 100) / 100).toBe(r.revisedTotal);
  });

  it("blocks when the ledger is out of balance", () => {
    const r = checkInstallmentIntegrity({ ...base, ledger: { ...base.ledger, liabilityCredit: 3400 } });
    expect(r.hasErrors).toBe(true);
    expect(r.checks.find((c) => c.id === "ledger")?.status).toBe("error");
  });

  it("blocks when the asset cost differs from the ledger debit", () => {
    const r = checkInstallmentIntegrity({ ...base, assetCost: 2555.91 });
    expect(r.checks.find((c) => c.id === "asset")?.status).toBe("error");
    expect(r.hasErrors).toBe(true);
  });

  it("blocks when the count is not above the paid installments", () => {
    const r = checkInstallmentIntegrity({ ...base, nextInstallmentCount: 1 });
    expect(r.hasErrors).toBe(true);
  });

  it("blocks when settled payments exceed the revised total", () => {
    const r = checkInstallmentIntegrity({ ...base, paidAmount: 5000, nextFinanceCharge: 0 });
    expect(r.checks.find((c) => c.id === "schedule")?.status).toBe("error");
  });

  it("warns without blocking when ledger rows cannot be read", () => {
    const r = checkInstallmentIntegrity({ ...base, ledger: { ...base.ledger, unavailable: true } });
    expect(r.hasWarnings).toBe(true);
    expect(r.hasErrors).toBe(false);
  });

  it("schedule split absorbs rounding on the last row", () => {
    const rows = recalcSchedule(1000, 3);
    expect(rows).toEqual([333.33, 333.33, 333.34]);
  });
});
