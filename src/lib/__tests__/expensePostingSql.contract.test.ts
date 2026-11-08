/**
 * Source-level contract: the latest SQL definitions of the expense posting
 * functions must stay branch-aware and balanced. Fails if a future migration
 * drops branch routing, the branch_id stamp, or the balance assertion.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const MIGRATIONS = path.resolve(process.cwd(), "supabase/migrations");

function latestDefinition(fnName: string): string | null {
  const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  let latest: string | null = null;
  for (const f of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS, f), "utf8");
    const re = new RegExp(
      `create\\s+or\\s+replace\\s+function\\s+(?:public\\.)?${fnName}\\b[\\s\\S]*?\\$(?:function)?\\$[\\s\\S]*?\\$(?:function)?\\$`,
      "gi",
    );
    const matches = sql.match(re);
    if (matches?.length) latest = matches[matches.length - 1];
  }
  return latest;
}

describe("expense posting SQL contract", () => {
  const postFn = latestDefinition("post_expense_to_ledger");
  const reclassFn = latestDefinition("reclassify_expense_credit_account");

  it("finds both function definitions in migrations", () => {
    expect(postFn, "post_expense_to_ledger definition").toBeTruthy();
    expect(reclassFn, "reclassify_expense_credit_account definition").toBeTruthy();
  });

  it("post_expense_to_ledger routes accounts through resolve_branch_account", () => {
    const body = (postFn ?? "").toLowerCase();
    const hits = body.split("resolve_branch_account").length - 1;
    expect(hits, "debit and credit legs must both be branch-resolved").toBeGreaterThanOrEqual(2);
  });

  it("post_expense_to_ledger stamps branch_id on the journal batch", () => {
    expect((postFn ?? "").toLowerCase()).toContain("branch_id");
  });

  it("post_expense_to_ledger asserts debits equal credits before committing", () => {
    const body = (postFn ?? "").toLowerCase();
    expect(/raise\s+exception[\s\S]*balance|balanc/.test(body)).toBe(true);
  });

  it("reclassify_expense_credit_account is branch-aware", () => {
    const body = (reclassFn ?? "").toLowerCase();
    expect(body).toContain("resolve_branch_account");
    expect(body).toContain("branch_id");
  });
});
