import { describe, expect, it } from "vitest";
import {
  buildRejectionRecord,
  normaliseFields,
  rejectionsToCsv,
  summariseRejections,
  type PostingRejectionRow,
} from "../postingRejectionLog";
import type { RuleViolation } from "../accountPostingRules";

const violation: RuleViolation = {
  rule: "expense_to_fixed_asset",
  title: "Fixed asset blocked",
  message: 'Account "1510" is a fixed asset',
  why: "why",
  offending: [{ label: "1510 · Kitchen Equipment", note: "Fixed asset account" }],
  fixes: [{ label: "Use the register", detail: "d" }],
};

const row = (over: Partial<PostingRejectionRow> = {}): PostingRejectionRow => ({
  id: "r1",
  tenant_id: "t1",
  branch_id: null,
  user_id: null,
  occurred_at: new Date().toISOString(),
  rule: "expense_to_fixed_asset",
  source: "expense_form",
  origin: "client",
  title: "Fixed asset blocked",
  message: 'Account "1510"',
  route: "/expenses",
  entity_type: "expense",
  entity_id: null,
  attempted_amount: 4000,
  attempted_date: "2026-05-01",
  offending_accounts: [{ label: "1510 · Kitchen Equipment", note: "n" }],
  offending_fields: [{ field: "account_id", label: "Expense account", value: "1510" }],
  attempted_values: {},
  ...over,
});

describe("buildRejectionRecord", () => {
  it("captures the rule, fields and attempted values", () => {
    const rec = buildRejectionRecord(violation, {
      tenantId: "t1",
      source: "expense_form",
      attemptedAmount: 4000,
      attemptedDate: "2026-05-01",
      fields: [{ field: "account_id", label: "Expense account", value: "1510" }],
      values: { description: "Fryer" },
    })!;
    expect(rec.rule).toBe("expense_to_fixed_asset");
    expect(rec.origin).toBe("client");
    expect(rec.offending_accounts).toHaveLength(1);
    expect((rec.offending_fields as unknown[])).toHaveLength(1);
    expect(rec.attempted_values).toEqual({ description: "Fryer" });
  });

  it("returns null without a tenant so we never write orphan rows", () => {
    expect(buildRejectionRecord(violation, { tenantId: null, source: "other" })).toBeNull();
  });

  it("drops non-finite amounts", () => {
    const rec = buildRejectionRecord(violation, {
      tenantId: "t1",
      source: "other",
      attemptedAmount: Number.NaN,
    })!;
    expect(rec.attempted_amount).toBeNull();
  });
});

describe("normaliseFields", () => {
  it("blanks empty values and keeps labels", () => {
    expect(normaliseFields([{ field: "category_id", label: "Category", value: "" }])).toEqual([
      { field: "category_id", label: "Category", value: null },
    ]);
    expect(normaliseFields([{ field: "", label: "x", value: "1" }])).toHaveLength(0);
  });
});

describe("summariseRejections", () => {
  it("groups by rule, source and recency", () => {
    const old = row({ id: "r2", occurred_at: "2020-01-01T00:00:00Z", source: "chart_of_accounts" });
    const s = summariseRejections([row(), old]);
    expect(s.total).toBe(2);
    expect(s.byRule.expense_to_fixed_asset).toBe(2);
    expect(s.bySource.chart_of_accounts).toBe(1);
    expect(s.last24h).toBe(1);
  });
});

describe("rejectionsToCsv", () => {
  it("exports fields and escapes quotes", () => {
    const csv = rejectionsToCsv([row()]);
    expect(csv.split("\n")[0]).toContain("Offending fields");
    expect(csv).toContain('Account ""1510""');
    expect(csv).toContain("Expense account=1510");
  });
});
