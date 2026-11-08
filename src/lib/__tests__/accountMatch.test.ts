import { describe, expect, it } from "vitest";
import { extractAccountCode, isDebitableAccount, matchAccount } from "../accountMatch";
import type { ChartOfAccount } from "@/hooks/useChartOfAccounts";

const acc = (id: string, code: string, name: string, type = "expense", extra: Partial<ChartOfAccount> = {}) =>
  ({ id, account_code: code, account_name: name, account_type: type, is_active: true, ...extra }) as ChartOfAccount;

const chart = [
  acc("a1", "1550", "Construction in Progress", "asset"),
  acc("a2", "6210", "Repairs & Maintenance"),
  acc("a3", "6220", "Repairs - Vehicles"),
  acc("a4", "5100", "Food Cost", "cogs"),
  acc("a5", "9999", "Archived Account", "expense", { is_active: false }),
];

describe("extractAccountCode", () => {
  it("pulls the leading numeric code", () => {
    expect(extractAccountCode("6210 - Repairs")).toBe("6210");
    expect(extractAccountCode("Repairs")).toBeNull();
  });
});

describe("matchAccount", () => {
  it("matches on account code", () => {
    const m = matchAccount("6210", chart);
    expect(m.account?.id).toBe("a2");
    expect(m.confidence).toBe("code");
  });

  it("matches on code + name", () => {
    expect(matchAccount("6210 - Repairs & Maintenance", chart).confidence).toBe("code_name");
  });

  it("matches on exact name regardless of punctuation", () => {
    const m = matchAccount("construction in progress", chart);
    expect(m.account?.id).toBe("a1");
    expect(m.confidence).toBe("name");
  });

  it("returns candidates instead of guessing when ambiguous", () => {
    const m = matchAccount("Repairs", chart);
    expect(m.account).toBeNull();
    expect(m.candidates.length).toBe(2);
    expect(m.reason).toMatch(/ambiguous/i);
  });

  it("reports unknown codes rather than falling back to a name match", () => {
    const m = matchAccount("7777", chart);
    expect(m.account).toBeNull();
    expect(m.reason).toMatch(/No account with code 7777/);
  });

  it("ignores inactive accounts", () => {
    expect(matchAccount("9999", chart).account).toBeNull();
  });

  it("handles empty input", () => {
    expect(matchAccount("", chart).confidence).toBe("none");
  });

  it("only allows expense, cogs and asset accounts as debit targets", () => {
    expect(isDebitableAccount(chart[0])).toBe(true);
    expect(isDebitableAccount(chart[3])).toBe(true);
    expect(isDebitableAccount(acc("x", "4000", "Sales", "revenue"))).toBe(false);
  });
});
