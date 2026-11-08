/**
 * Human labels for breadcrumb segments.
 *
 * Keys are full pathnames (preferred) or single path segments (fallback).
 * Anything not listed falls back to a title-cased version of the segment,
 * so new routes still render a sensible crumb without an entry here.
 */
export const ROUTE_LABELS: Record<string, string> = {
  // sections (first segment)
  reports: "Reports",
  accounting: "Accounting",
  expenses: "Expenses",
  inventory: "Inventory",
  admin: "Administration",
  settings: "Settings",
  debug: "Diagnostics",

  // leaf routes
  "/dashboard": "Dashboard",
  "/finance-dashboard": "Finance Dashboard",
  "/vat-return": "VAT Return",
  "/reports/vat-audit": "VAT Audit",
  "/reports/seo-diagnostics": "SEO Diagnostics",
  "/reports/ap-aging": "AP Aging",
  "/reports/sale-posting-monitor": "Sale Posting Monitor",
  "/reports/pos-ack-diagnostics": "POS Ack Diagnostics",
  "/reports/daily-reconciliation": "Daily Reconciliation",
  "/reports/card-sales-by-branch": "Card Sales by Branch",
  "/reports/branch-ledger": "Branch Ledger",
  "/reports/expense-ledger-reconciliation": "Expense Ledger Reconciliation",
  "/reports/invoice-ledger-reconciliation": "Invoice Ledger Reconciliation",
  "/accounting/owner-capital": "Owner Capital",
  "/accounting/card-settlement-clearing": "Card Settlement Clearing",
  "/expenses/pending-vat-split": "Pending VAT Split",
  "/pos-terminals": "POS Terminals",
  "/coa": "Chart of Accounts",
  "/cogs": "COGS",
};

const ACRONYMS = new Set(["vat", "pos", "ap", "ar", "coa", "cogs", "kpi", "seo", "pnl", "dlq", "bnpl"]);

export function labelForSegment(segment: string): string {
  const lower = segment.toLowerCase();
  if (ROUTE_LABELS[lower]) return ROUTE_LABELS[lower];
  return segment
    .split("-")
    .map((w) => (ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

export interface Crumb {
  label: string;
  href: string;
  isLast: boolean;
}

/** Builds breadcrumb trail for a pathname, always rooted at Dashboard. */
export function buildCrumbs(pathname: string): Crumb[] {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return [];

  const crumbs: Crumb[] = [];
  let href = "";
  segments.forEach((seg, i) => {
    href += `/${seg}`;
    const isLast = i === segments.length - 1;
    // Skip opaque ids (uuid / numeric) — they add noise, not navigation.
    const isId = /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(seg) || /^\d+$/.test(seg);
    crumbs.push({
      label: isId ? "Details" : (ROUTE_LABELS[href] ?? labelForSegment(seg)),
      href,
      isLast,
    });
  });

  if (segments[0] !== "dashboard") {
    crumbs.unshift({ label: "Dashboard", href: "/dashboard", isLast: false });
  }
  return crumbs;
}
