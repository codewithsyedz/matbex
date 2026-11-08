import { describe, expect, it } from "vitest";
import { buildMigrationPlan, STANDARD_COA, type StandardAccount } from "@/lib/coaMigrationPlan";
import type { ChartOfAccount } from "@/hooks/useChartOfAccounts";

const acct = (p: Partial<ChartOfAccount>): ChartOfAccount => ({
  id: p.account_code ?? "id",
  tenant_id: "t",
  account_code: "1000",
  account_name: "Cash in Hand",
  account_type: "asset",
  parent_id: null,
  description: null,
  is_system_account: false,
  is_active: true,
  balance: 0,
  created_at: "",
  updated_at: "",
  ...p,
});

const std: StandardAccount[] = [
  { code: "1000", name: "Cash in Hand", type: "asset", aliases: ["petty cash"] },
  { code: "2000", name: "Accounts Payable", type: "liability", aliases: ["creditors"] },
];

describe("buildMigrationPlan", () => {
  it("marks identical accounts as no-change", () => {
    const plan = buildMigrationPlan([acct({})], std);
    const row = plan.rows.find((r) => r.target?.code === "1000")!;
    expect(row.action).toBe("match");
    expect(row.changes).toHaveLength(0);
    expect(row.defaultSelected).toBe(false);
  });

  it("renames when the code matches but the name differs", () => {
    const plan = buildMigrationPlan([acct({ account_name: "Till Money" })], std);
    const row = plan.rows.find((r) => r.target?.code === "1000")!;
    expect(row.action).toBe("rename");
    expect(row.changes[0]).toMatchObject({ field: "account_name", to: "Cash in Hand" });
  });

  it("re-codes accounts matched by alias", () => {
    const plan = buildMigrationPlan([acct({ id: "a", account_code: "1001", account_name: "Petty Cash" })], std);
    const row = plan.rows.find((r) => r.target?.code === "1000")!;
    expect(row.action).toBe("recode");
    expect(row.changes.some((c) => c.field === "account_code" && c.to === "1000")).toBe(true);
  });

  it("flags a conflict when the target code is taken", () => {
    const plan = buildMigrationPlan(
      [
        acct({ id: "a", account_code: "1001", account_name: "Petty Cash" }),
        acct({ id: "b", account_code: "1000", account_name: "Random Wallet" }),
      ],
      std,
    );
    const row = plan.rows.find((r) => r.existing?.id === "a");
    // 1000 already claimed by code match, so "a" becomes unmapped or conflicted
    expect(plan.rows.some((r) => r.conflict) || row?.action === "unmapped").toBe(true);
  });

  it("blocks type changes on accounts with transactions", () => {
    const plan = buildMigrationPlan(
      [acct({ id: "c", account_code: "2000", account_name: "Accounts Payable", account_type: "expense", has_transactions: true })],
      std,
    );
    const row = plan.rows.find((r) => r.target?.code === "2000")!;
    expect(row.action).toBe("retype");
    expect(row.conflict).toMatch(/posted transactions/);
    expect(row.defaultSelected).toBe(false);
  });

  it("creates missing standard accounts", () => {
    const plan = buildMigrationPlan([], std);
    expect(plan.counts.create).toBe(2);
    expect(plan.actionable).toBe(2);
  });

  it("keeps custom accounts untouched", () => {
    const plan = buildMigrationPlan([acct({ id: "x", account_code: "6812", account_name: "Falcon Sponsorship", account_type: "expense" })], std);
    const row = plan.rows.find((r) => r.existing?.id === "x")!;
    expect(row.action).toBe("unmapped");
    expect(row.changes).toHaveLength(0);
  });

  it("ships a standard chart with unique codes", () => {
    const codes = STANDARD_COA.map((a) => a.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});
