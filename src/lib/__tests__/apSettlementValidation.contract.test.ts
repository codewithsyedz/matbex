/**
 * Source-level contract: AP settlement entries (DR 2000 Accounts Payable /
 * CR Cash-Bank) must always pass the ledger validation trigger.
 *
 * Regression guard for the VALIDATION_ERROR that blocked marking supplier
 * bills as Paid ("Expense debit entries should use Expense (6000-6999) or
 * COGS (5000-5999) accounts. Account 2000 - Accounts Payable is type
 * liability").
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

/** Extract the `journal_type = 'expense'` branch of the validator. */
function expenseBranch(body: string): string {
  const lower = body.toLowerCase();
  const start = lower.indexOf("v_batch.journal_type = 'expense'");
  expect(start, "expense branch present in validator").toBeGreaterThan(-1);
  // Stop before the shared (non-branch-specific) partner/fixed-asset guards so
  // assertions only look at expense-branch rules.
  const after = lower.slice(start);
  const end = after.indexOf("v_is_partner :=");
  return end > -1 ? after.slice(0, end) : after;
}

describe("AP settlement ledger validation contract", () => {
  const validator = latestDefinition("validate_journal_entry_accounts");
  const reclassFn = latestDefinition("reclassify_expense_credit_account");

  it("finds the ledger validation function in migrations", () => {
    expect(validator, "validate_journal_entry_accounts definition").toBeTruthy();
  });

  it("allows liability (Accounts Payable) debits on expense journal batches", () => {
    const branch = expenseBranch(validator ?? "");
    const allowsLiabilityType = branch.includes("v_account.account_type = 'liability'");
    const allowsApRange = /account_code\s*>=\s*'2000'[\s\S]{0,80}account_code\s*<\s*'3000'/.test(branch);
    expect(
      allowsLiabilityType || allowsApRange,
      "DR 2000 Accounts Payable must be accepted so bills can be settled",
    ).toBe(true);
  });

  it("still rejects nonsense expense debits (equity/revenue accounts)", () => {
    const branch = expenseBranch(validator ?? "");
    // The guard must remain a whitelist that raises, not be removed wholesale.
    expect(branch).toContain("raise exception");
    expect(branch).toContain("validation_error: expense debit entries");
    expect(branch).not.toContain("account_type = 'equity'");
    expect(branch).not.toContain("account_type = 'revenue'");
  });

  it("keeps inventory accounts out of expense batches", () => {
    const branch = expenseBranch(validator ?? "");
    expect(/account_code\s*>=\s*'1200'/.test(branch)).toBe(true);
  });

  it("settlement routine posts a DR Accounts Payable / CR funding-account pair", () => {
    const body = (reclassFn ?? "").toLowerCase();
    expect(reclassFn, "reclassify_expense_credit_account definition").toBeTruthy();
    // Settlement must debit AP (2000) and credit the resolved funding account.
    expect(/'2000'/.test(body), "debits Accounts Payable 2000").toBe(true);
    expect(
      body.includes("resolve_expense_funding_account") || /'10\d{2}'/.test(body),
      "credits the resolved cash/bank/partner funding account",
    ).toBe(true);
    expect(body).toContain("v_cash_account");
  });

  it("settlement routine does not reference a non-existent payment_date field", () => {
    const body = (reclassFn ?? "").toLowerCase();
    expect(body).not.toContain("v_exp.payment_date");
  });
});