/**
 * Pure planner that maps a tenant's EXISTING chart of accounts onto the
 * standard Matbex restaurant structure.
 *
 * Nothing here touches the API - the screen renders the plan, the user
 * confirms, and only then does the caller apply the actions.
 */
import type { AccountType, ChartOfAccount } from "@/hooks/useChartOfAccounts";

export interface StandardAccount {
  code: string;
  name: string;
  type: AccountType;
  /** Alternate legacy names we've seen tenants use for this account. */
  aliases?: string[];
  description?: string;
}

/** Canonical structure new tenants are provisioned with. */
export const STANDARD_COA: StandardAccount[] = [
  // Assets
  { code: "1000", name: "Cash in Hand", type: "asset", aliases: ["petty cash", "cash", "cash on hand", "till"] },
  { code: "1010", name: "Cash in Bank", type: "asset", aliases: ["bank", "bank account", "current account"] },
  { code: "1015", name: "Card Settlements Receivable", type: "asset", aliases: ["card clearing", "mada receivable", "card receivable"] },
  { code: "1100", name: "Accounts Receivable", type: "asset", aliases: ["debtors", "customer receivable", "trade receivable"] },
  { code: "1150", name: "Staff Advances", type: "asset", aliases: ["employee advances", "salary advance", "advances to staff"] },
  { code: "1180", name: "Input VAT Recoverable", type: "asset", aliases: ["input vat", "vat receivable", "recoverable vat"] },
  { code: "1200", name: "Food Inventory", type: "asset", aliases: ["stock", "inventory", "food stock", "kitchen inventory"] },
  { code: "1220", name: "Packaging Inventory", type: "asset", aliases: ["packaging stock", "disposables"] },
  { code: "1500", name: "Kitchen Equipment", type: "asset", aliases: ["equipment", "machinery", "kitchen assets"] },
  { code: "1510", name: "Furniture & Fixtures", type: "asset", aliases: ["furniture", "fixtures", "fitout"] },
  { code: "1550", name: "Capital Work in Progress", type: "asset", aliases: ["cip", "work in progress", "wip"] },
  { code: "1590", name: "Accumulated Depreciation", type: "asset", aliases: ["accum depreciation", "depreciation reserve"] },
  // Liabilities
  { code: "2000", name: "Accounts Payable", type: "liability", aliases: ["creditors", "supplier payable", "trade payable", "payables"] },
  { code: "2100", name: "Accrued Liabilities", type: "liability", aliases: ["accruals", "accrued expenses"] },
  { code: "2150", name: "Payroll Payable", type: "liability", aliases: ["salaries payable", "wages payable"] },
  { code: "2200", name: "Output VAT Payable", type: "liability", aliases: ["output vat", "vat payable", "sales vat"] },
  { code: "2410", name: "Partner Loan Account", type: "liability", aliases: ["partner loan", "director loan", "shareholder loan"] },
  { code: "2450", name: "BNPL / Installment Payable", type: "liability", aliases: ["tabby payable", "tamara payable", "installment payable"] },
  // Equity
  { code: "3000", name: "Owner Capital", type: "equity", aliases: ["capital", "share capital", "owners equity"] },
  { code: "3100", name: "Owner Drawings", type: "equity", aliases: ["drawings", "withdrawals"] },
  { code: "3900", name: "Retained Earnings", type: "equity", aliases: ["accumulated profit", "retained profit"] },
  // Revenue
  { code: "4000", name: "Dine-in Sales", type: "revenue", aliases: ["restaurant sales", "in-store sales"] },
  { code: "4010", name: "Takeaway Sales", type: "revenue", aliases: ["pickup sales", "take away"] },
  { code: "4020", name: "Delivery Sales", type: "revenue", aliases: ["aggregator sales", "online sales", "delivery"] },
  { code: "4900", name: "Other Income", type: "revenue", aliases: ["misc income", "sundry income"] },
  // COGS
  { code: "5001", name: "Cost of Food Sold", type: "cogs", aliases: ["food cost", "cogs food", "raw material cost"] },
  { code: "5002", name: "Beverage Cost", type: "cogs", aliases: ["drinks cost", "beverage cogs"] },
  { code: "5003", name: "Dairy Cost", type: "cogs", aliases: ["milk cost", "dairy cogs"] },
  { code: "5100", name: "Packaging Cost", type: "cogs", aliases: ["disposables cost", "packing cost"] },
  // Expenses
  { code: "6000", name: "Salaries & Wages", type: "expense", aliases: ["payroll", "salary expense", "wages"] },
  { code: "6100", name: "Rent Expense", type: "expense", aliases: ["rent", "lease expense"] },
  { code: "6200", name: "Utilities", type: "expense", aliases: ["electricity", "water", "gas bill", "utility expense"] },
  { code: "6300", name: "Repairs & Maintenance", type: "expense", aliases: ["maintenance", "repairs"] },
  { code: "6400", name: "Marketing & Advertising", type: "expense", aliases: ["marketing", "advertising", "promotions"] },
  { code: "6500", name: "Government & License Fees", type: "expense", aliases: ["balady", "municipality fees", "licenses"] },
  { code: "6600", name: "Bank & Card Fees", type: "expense", aliases: ["bank charges", "merchant fees", "card commission"] },
  { code: "6700", name: "Depreciation Expense", type: "expense", aliases: ["depreciation"] },
  { code: "6900", name: "Waste & Spoilage", type: "expense", aliases: ["wastage", "spoilage"] },
  { code: "6995", name: "Daily Overhead Absorbed", type: "expense", aliases: ["overhead per day", "daily overhead"] },
];

export type MigrationAction =
  | "match"       // already correct - nothing to do
  | "rename"      // same code, name will be standardised
  | "recode"      // matched by name, code will change
  | "retype"      // account type will be corrected
  | "create"      // standard account missing entirely
  | "unmapped";   // custom account, left untouched

export interface MigrationRow {
  key: string;
  action: MigrationAction;
  /** Present for everything except `create`. */
  existing: ChartOfAccount | null;
  /** Present for everything except `unmapped`. */
  target: StandardAccount | null;
  /** Fields that will actually change when applied. */
  changes: { field: "account_code" | "account_name" | "account_type"; from: string; to: string }[];
  /** Blocking problem - the row cannot be applied. */
  conflict: string | null;
  /** Whether the row is selected for apply by default. */
  defaultSelected: boolean;
  note: string;
}

export interface MigrationPlan {
  rows: MigrationRow[];
  counts: Record<MigrationAction, number>;
  conflicts: number;
  /** Rows that would change data if applied. */
  actionable: number;
}

const norm = (v: string) =>
  (v ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

function nameMatches(account: ChartOfAccount, std: StandardAccount): boolean {
  const n = norm(account.account_name);
  if (!n) return false;
  if (n === norm(std.name)) return true;
  return (std.aliases ?? []).some((a) => {
    const an = norm(a);
    return n === an || n.includes(an) || an.includes(n);
  });
}

export function buildMigrationPlan(
  accounts: ChartOfAccount[],
  standard: StandardAccount[] = STANDARD_COA,
): MigrationPlan {
  const rows: MigrationRow[] = [];
  const usedAccountIds = new Set<string>();
  const codeOwner = new Map<string, ChartOfAccount>();
  accounts.forEach((a) => codeOwner.set(a.account_code, a));

  for (const std of standard) {
    // 1. exact code match wins
    let existing = accounts.find((a) => a.account_code === std.code && !usedAccountIds.has(a.id)) ?? null;
    let matchedBy: "code" | "name" | null = existing ? "code" : null;

    // 2. otherwise match on name / alias
    if (!existing) {
      existing = accounts.find((a) => !usedAccountIds.has(a.id) && nameMatches(a, std)) ?? null;
      matchedBy = existing ? "name" : null;
    }

    if (!existing) {
      rows.push({
        key: `create-${std.code}`,
        action: "create",
        existing: null,
        target: std,
        changes: [],
        conflict: null,
        defaultSelected: true,
        note: `${std.code} ${std.name} is missing and will be created.`,
      });
      continue;
    }

    usedAccountIds.add(existing.id);

    const changes: MigrationRow["changes"] = [];
    if (existing.account_code !== std.code) {
      changes.push({ field: "account_code", from: existing.account_code, to: std.code });
    }
    if (norm(existing.account_name) !== norm(std.name)) {
      changes.push({ field: "account_name", from: existing.account_name, to: std.name });
    }
    if (existing.account_type !== std.type) {
      changes.push({ field: "account_type", from: existing.account_type, to: std.type });
    }

    let conflict: string | null = null;
    if (existing.account_code !== std.code) {
      const blocker = codeOwner.get(std.code);
      if (blocker && blocker.id !== existing.id) {
        conflict = `Code ${std.code} is already used by "${blocker.account_name}". Resolve that account first.`;
      }
    }
    if (!conflict && existing.account_type !== std.type && existing.has_transactions) {
      conflict = `Type change blocked: "${existing.account_name}" already has posted transactions.`;
    }

    let action: MigrationAction = "match";
    if (changes.some((c) => c.field === "account_type")) action = "retype";
    else if (changes.some((c) => c.field === "account_code")) action = "recode";
    else if (changes.length > 0) action = "rename";

    rows.push({
      key: `map-${existing.id}`,
      action,
      existing,
      target: std,
      changes,
      conflict,
      defaultSelected: action !== "match" && !conflict,
      note:
        action === "match"
          ? "Already aligned with the standard structure."
          : matchedBy === "name"
            ? `Matched by name to ${std.code} ${std.name}.`
            : `Matched by code ${std.code}.`,
    });
  }

  for (const account of accounts) {
    if (usedAccountIds.has(account.id)) continue;
    rows.push({
      key: `custom-${account.id}`,
      action: "unmapped",
      existing: account,
      target: null,
      changes: [],
      conflict: null,
      defaultSelected: false,
      note: "Custom account - kept exactly as-is unless you map it manually.",
    });
  }

  const counts: Record<MigrationAction, number> = {
    match: 0, rename: 0, recode: 0, retype: 0, create: 0, unmapped: 0,
  };
  rows.forEach((r) => { counts[r.action] += 1; });

  return {
    rows,
    counts,
    conflicts: rows.filter((r) => r.conflict).length,
    actionable: rows.filter((r) => r.action !== "match" && r.action !== "unmapped" && !r.conflict).length,
  };
}

export const ACTION_LABELS: Record<MigrationAction, string> = {
  match: "No change",
  rename: "Rename",
  recode: "Re-code",
  retype: "Change type",
  create: "Create",
  unmapped: "Keep custom",
};
