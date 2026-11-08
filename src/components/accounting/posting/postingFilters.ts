/**
 * Pure filter helpers for the Posting Center. Kept dependency-free so the
 * matching logic can be unit tested without React or Supabase.
 */
import type {
  ImbalancedExpense,
  UnpostedExpense,
} from "@/hooks/usePostingCenter";

export interface PostingFilterState {
  search: string;
  reasonCode: string | "all";
  branchId: string | "all";
  shiftId: string | "all";
  dateFrom: string | null; // ISO yyyy-mm-dd
  dateTo: string | null;   // ISO yyyy-mm-dd
}

export const emptyPostingFilters: PostingFilterState = {
  search: "",
  reasonCode: "all",
  branchId: "all",
  shiftId: "all",
  dateFrom: null,
  dateTo: null,
};

function inDateRange(dateStr: string, from: string | null, to: string | null) {
  if (from && dateStr < from) return false;
  if (to && dateStr > to) return false;
  return true;
}

function inSearch(haystacks: Array<string | null | undefined>, q: string) {
  if (!q) return true;
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return haystacks.some((h) => (h ?? "").toLowerCase().includes(needle));
}

export interface ShiftLookup {
  /** Map of expense_id -> shift_id (loaded once by the caller). */
  [expenseId: string]: string | null;
}

export function filterUnposted(
  rows: UnpostedExpense[],
  filters: PostingFilterState,
  shiftLookup: ShiftLookup = {},
): UnpostedExpense[] {
  return rows.filter((r) => {
    if (filters.reasonCode !== "all" && r.classification?.reason_code !== filters.reasonCode) return false;
    if (filters.branchId !== "all" && (r.branch_id ?? "") !== filters.branchId) return false;
    if (filters.shiftId !== "all" && (shiftLookup[r.id] ?? "") !== filters.shiftId) return false;
    if (!inDateRange(r.expense_date, filters.dateFrom, filters.dateTo)) return false;
    if (
      !inSearch(
        [r.description, r.account?.account_code, r.account?.account_name, r.branch?.name],
        filters.search,
      )
    ) {
      return false;
    }
    return true;
  });
}

export function filterImbalanced(
  rows: ImbalancedExpense[],
  filters: PostingFilterState,
  shiftLookup: ShiftLookup = {},
): ImbalancedExpense[] {
  return rows.filter((r) => {
    if (filters.branchId !== "all" && (r.branch_id ?? "") !== filters.branchId) return false;
    if (filters.shiftId !== "all" && (shiftLookup[r.id] ?? "") !== filters.shiftId) return false;
    if (!inDateRange(r.expense_date, filters.dateFrom, filters.dateTo)) return false;
    if (!inSearch([r.description, r.branch?.name], filters.search)) return false;
    return true;
  });
}

/** Reason-code options visible in the filter dropdown. */
export const REASON_FILTER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "all", label: "All reasons" },
  { value: "ready", label: "Ready to post" },
  { value: "pending_approval", label: "Pending approval" },
  { value: "period_locked", label: "Period locked" },
  { value: "missing_account", label: "Missing account" },
  { value: "missing_branch_visibility", label: "Branch visibility" },
  { value: "cogs_routed", label: "Routed via COGS" },
  { value: "validation_failed", label: "Validation failed" },
];