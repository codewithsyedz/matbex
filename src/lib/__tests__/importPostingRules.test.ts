import { describe, expect, it } from "vitest";
import { evaluateImportPostingRules, importPostingRuleCsv } from "@/lib/importPostingRules";

const acc = (code: string, name: string, type: string) => ({
  account_code: code,
  account_name: name,
  account_type: type,
});

describe("evaluateImportPostingRules", () => {
  it("blocks partner loan accounts on import rows", () => {
    const r = evaluateImportPostingRules([
      { rowNumber: 2, account: acc("2410", "Partner Loan - Ali", "liability") },
    ]);
    expect(r.blockedCount).toBe(1);
    expect(r.byIndex[0].rule).toBe("partner_account_as_expense");
  });

  it("blocks fixed-asset accounts without a capitalisation context", () => {
    const r = evaluateImportPostingRules([
      { rowNumber: 2, account: acc("1510", "Kitchen Equipment", "asset") },
    ]);
    expect(r.byIndex[0].rule).toBe("expense_to_fixed_asset");
  });

  it("allows fixed-asset accounts when linked to a project", () => {
    const r = evaluateImportPostingRules(
      [{ rowNumber: 2, account: acc("1510", "Kitchen Equipment", "asset") }],
      { projectId: "p1" },
    );
    expect(r.blockedCount).toBe(0);
  });

  it("passes clean expense rows and unresolved accounts", () => {
    const r = evaluateImportPostingRules([
      { rowNumber: 2, account: acc("6300", "Repairs", "expense") },
      { rowNumber: 3, account: null },
    ]);
    expect(r.blockedCount).toBe(0);
  });

  it("exports per-row reasons as CSV", () => {
    const r = evaluateImportPostingRules([
      { rowNumber: 5, accountText: "1510 Equipment", account: acc("1510", "Kitchen Equipment", "asset") },
    ]);
    const csv = importPostingRuleCsv(r);
    expect(csv).toContain("5,expense_to_fixed_asset");
    expect(csv).toContain("1510 Equipment");
  });
});
