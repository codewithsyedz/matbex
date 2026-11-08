import { describe, expect, it } from "vitest";
import {
  checkExpenseNotFixedAsset,
  checkPartnerFundingNotRevenue,
  isFixedAssetAccount,
  isPartnerFundingAccount,
  type PostingAccount,
} from "../accountPostingRules";

const a = (code: string, name: string, type: string, fa = false): PostingAccount => ({
  id: code,
  account_code: code,
  account_name: name,
  account_type: type,
  is_fixed_asset_account: fa,
});

const partnerLoan = a("2410", "Partner Loan - Ahmed", "liability");
const partnerCapital = a("3401", "Partner Capital - Ahmed", "equity");
const sales = a("4000", "Food Sales", "revenue");
const cash = a("1010", "Cash in Bank", "asset");
const equipment = a("1500", "Kitchen Equipment", "asset", true);
const rent = a("6100", "Rent", "expense");

describe("classification helpers", () => {
  it("detects partner funding accounts by code and by name", () => {
    expect(isPartnerFundingAccount(partnerLoan)).toBe(true);
    expect(isPartnerFundingAccount(partnerCapital)).toBe(true);
    expect(isPartnerFundingAccount(a("2900", "Owner Current Account", "liability"))).toBe(true);
    expect(isPartnerFundingAccount(rent)).toBe(false);
    expect(isPartnerFundingAccount(a("2100", "Accounts Payable", "liability"))).toBe(false);
  });

  it("detects fixed asset accounts by flag and by 1500-series code", () => {
    expect(isFixedAssetAccount(equipment)).toBe(true);
    expect(isFixedAssetAccount(a("1560", "Business Acquisition Cost", "asset"))).toBe(true);
    expect(isFixedAssetAccount(a("1010", "Cash", "asset", true))).toBe(true);
    expect(isFixedAssetAccount(cash)).toBe(false);
  });
});

describe("checkPartnerFundingNotRevenue", () => {
  it("allows a clean partner loan entry (DR Cash / CR Partner Loan)", () => {
    expect(checkPartnerFundingNotRevenue([cash, partnerLoan])).toBeNull();
  });

  it("blocks a partner loan credited to revenue", () => {
    const v = checkPartnerFundingNotRevenue([cash, partnerLoan, sales]);
    expect(v?.rule).toBe("partner_funding_as_revenue");
    expect(v?.message).toMatch(/financing, not sales income/);
  });

  it("blocks a partner account mis-typed as revenue", () => {
    const v = checkPartnerFundingNotRevenue([a("2415", "Partner Loan - Sara", "revenue")]);
    expect(v?.message).toMatch(/never revenue/);
  });

  it("leaves ordinary sales entries alone", () => {
    expect(checkPartnerFundingNotRevenue([cash, sales])).toBeNull();
  });
});

describe("checkExpenseNotFixedAsset", () => {
  it("blocks an expense charged to a fixed asset account", () => {
    const v = checkExpenseNotFixedAsset(equipment);
    expect(v?.rule).toBe("expense_to_fixed_asset");
    expect(v?.message).toMatch(/Fixed Asset Register/);
  });

  it("allows it when the spend is a project acquisition", () => {
    expect(checkExpenseNotFixedAsset(equipment, { projectId: "p1" })).toBeNull();
  });

  it("allows it from the fixed asset register or an opening balance", () => {
    expect(checkExpenseNotFixedAsset(equipment, { viaFixedAssetRegister: true })).toBeNull();
    expect(checkExpenseNotFixedAsset(equipment, { isOpeningBalanceOrAdjustment: true })).toBeNull();
  });

  it("blocks partner accounts being used as an expense account", () => {
    expect(checkExpenseNotFixedAsset(partnerCapital)?.rule).toBe("partner_account_as_expense");
  });

  it("allows a normal expense account and handles a missing account", () => {
    expect(checkExpenseNotFixedAsset(rent)).toBeNull();
    expect(checkExpenseNotFixedAsset(null)).toBeNull();
  });
});
