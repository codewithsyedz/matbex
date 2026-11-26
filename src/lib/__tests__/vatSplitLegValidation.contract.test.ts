/**
 * Regression guard for the "VALIDATION_ERROR: Expense debit entries should use
 * Expense or COGS accounts" failure that blocked VAT-inclusive expenses whose
 * split legs debit Input VAT Recoverable (1180).
 *
 * Covers both sides of the fix:
 *  1. the SQL validator must keep accepting Input VAT / AP debits on expense
 *     and purchase batches (source-level contract against the migrations), and
 *  2. the UI parser must name the rejected leg so the user knows what to fix.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseLedgerValidationError } from "../ledgerValidationError";

const MIGRATIONS = path.resolve(process.cwd(), "db/migrations");

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

const validator = (latestDefinition("validate_journal_entry_accounts") ?? "").toLowerCase();

function branchOf(marker: string): string {
  const start = validator.indexOf(marker);
  expect(start, `${marker} branch present in validator`).toBeGreaterThan(-1);
  const after = validator.slice(start);
  const end = after.indexOf("v_is_partner :=");
  return end > -1 ? after.slice(0, end) : after;
}

describe("Input VAT split-leg ledger validation contract", () => {
  it("finds the validator definition", () => {
    expect(validator.length).toBeGreaterThan(0);
  });

  it("recognises Input VAT accounts by code and by name", () => {
    expect(/v_is_input_vat\s*:=/.test(validator), "input VAT flag computed").toBe(true);
    expect(/'1180'/.test(validator)).toBe(true);
    expect(/'1181'/.test(validator)).toBe(true);
    expect(/'1182'/.test(validator)).toBe(true);
    expect(
      /input vat/.test(validator) && /vat recoverable/.test(validator),
      "name-based fallback keeps renamed VAT accounts working",
    ).toBe(true);
  });

  it("allows the Input VAT debit leg on expense batches", () => {
    const branch = branchOf("v_batch.journal_type = 'expense'");
    expect(branch).toContain("v_is_input_vat");
    // the VAT allowance must sit inside the debit whitelist, not after the raise
    const whitelist = branch.slice(branch.indexOf("new.debit"), branch.indexOf("raise exception", branch.indexOf("new.debit")));
    expect(whitelist).toContain("v_is_input_vat");
  });

  it("keeps the expense debit whitelist a whitelist (still raises)", () => {
    const branch = branchOf("v_batch.journal_type = 'expense'");
    expect(branch).toContain("raise exception");
    expect(branch).toContain("validation_error: expense debit entries");
    // VAT must not be waved through by allowing every asset account
    expect(branch).not.toContain("v_account.account_type = 'asset'");
    expect(branch).not.toContain("account_type = 'revenue'");
    expect(branch).not.toContain("account_type = 'equity'");
  });

  it("still blocks inventory accounts on expense batches", () => {
    const branch = branchOf("v_batch.journal_type = 'expense'");
    expect(/account_code\s*>=\s*'1200'/.test(branch)).toBe(true);
    expect(branch).toContain("1200-1299");
  });

  it("mentions Input VAT in the rejection message so the UI can explain it", () => {
    const branch = branchOf("v_batch.journal_type = 'expense'");
    expect(branch).toContain("input vat");
  });

  it("purchase batches accept the Input VAT leg too (VAT-inclusive supplier bills)", () => {
    const branch = branchOf("v_batch.journal_type = 'purchase'");
    expect(branch).toContain("v_is_input_vat");
  });
});

describe("parseLedgerValidationError — split legs", () => {
  const vatError = {
    message:
      'VALIDATION_ERROR: Expense debit entries should use Expense (6000-6999), COGS (5000-5999), Accounts Payable (2000-2999) or Input VAT Recoverable (1180) accounts. Account "1180 - Input VAT Recoverable" is type "asset".',
  };

  it("identifies the rejected Input VAT debit leg", () => {
    const parsed = parseLedgerValidationError(vatError);
    expect(parsed.isLedgerValidation).toBe(true);
    expect(parsed.code).toBe("VALIDATION_ERROR");
    expect(parsed.accountCode).toBe("1180");
    expect(parsed.accountName).toBe("Input VAT Recoverable");
    expect(parsed.accountType).toBe("asset");
    expect(parsed.legSide).toBe("debit");
    expect(parsed.entryType).toBe("expense");
  });

  it("surfaces every allowed range from the rule text", () => {
    const parsed = parseLedgerValidationError(vatError);
    expect(parsed.allowedRanges).toEqual(
      expect.arrayContaining(["6000-6999", "5000-5999", "2000-2999"]),
    );
  });

  it("names the rule and gives a chart-of-accounts fix", () => {
    const parsed = parseLedgerValidationError(vatError);
    expect(parsed.ruleName).toBeTruthy();
    expect(parsed.title.toLowerCase()).toContain("1180");
    expect(parsed.fix.toLowerCase()).toContain("chart of accounts");
  });

  it("classifies the AP settlement leg separately", () => {
    const parsed = parseLedgerValidationError({
      message:
        'VALIDATION_ERROR: Expense debit entries should use Expense accounts. Account "2000 - Accounts Payable" is type "liability".',
    });
    expect(parsed.accountCode).toBe("2000");
    expect(parsed.legSide).toBe("debit");
    expect(parsed.fix.toLowerCase()).toContain("accounts payable");
  });

  it("explains an inventory leg rejected on an expense entry", () => {
    const parsed = parseLedgerValidationError({
      message:
        "VALIDATION_ERROR: Expense entries should not use Inventory accounts (1200-1299). For inventory purchases, use PURCHASE entry type.",
    });
    expect(parsed.isLedgerValidation).toBe(true);
    expect(parsed.allowedRanges).toContain("1200-1299");
    expect(parsed.fix.toLowerCase()).toContain("inventory");
  });

  it("explains a missing branch on a split leg", () => {
    const parsed = parseLedgerValidationError({
      message: "BRANCH_REQUIRED: Journal line must carry a branch_id.",
    });
    expect(parsed.code).toBe("BRANCH_REQUIRED");
    expect(parsed.title.toLowerCase()).toContain("branch");
  });

  it("explains an unbalanced split (VAT leg dropped)", () => {
    const parsed = parseLedgerValidationError({
      message: "UNBALANCED: Total debit and credit must balance for this entry.",
    });
    expect(parsed.code).toBe("UNBALANCED");
    expect(parsed.fix.toLowerCase()).toContain("balance");
  });

  it("passes through non-ledger errors untouched", () => {
    const parsed = parseLedgerValidationError(new Error("network timeout"));
    expect(parsed.isLedgerValidation).toBe(false);
    expect(parsed.detail).toContain("network timeout");
  });
});
