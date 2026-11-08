---
name: Branch-Aware Accounting (Option 1+2)
description: account_transactions carries branch_id (auto-stamped); Trial Balance + P&L filter by activeBranchId; resolve_branch_account routes postings to per-branch sub-accounts when they exist
type: feature
---

## Schema
- `account_transactions.branch_id` (nullable FK → branches). NULL = shared/manual journal.
- `auto_stamp_account_tx_branch` BEFORE INSERT trigger resolves branch_id from the row's `(reference_type, reference_id)` looking at: sales_transactions, expenses, purchases, purchase_invoices, staff_advances. `inventory_usage` and `day_end_adjustments` have no branch_id today; entries from them stay NULL.
- Backfilled once from those source tables.
- Index: `(tenant_id, branch_id, transaction_date)`.

## Resolver
`public.resolve_branch_account(_parent_account_id, _branch_id) returns uuid`
- Returns the active child of `_parent_account_id` whose name ILIKE %branch_name%.
- Falls back to the parent when no match or branch_id is NULL.
- TS wrapper: `useResolveBranchAccount().resolve(parentAccountId)` reads `pinnedBranchId ?? activeBranchId` from `useBranch()`. First integration: `RecordExpenseDialog.handleSubmit` calls it just before `createExpense.mutate`.

## Reporting
- `useTrialBalance({ from, to, branchId })` — `.eq('branch_id', branchId)` when set; "all" / null = consolidated.
- `useProfitLoss(period, start, end, compare, branchId)` — applied to sales_transactions, expenses, cogs_purchases (via daily_cogs_submissions), overhead_allocation, and staff queries. Overhead with NULL branch_id is treated as shared and included in every branch view.
- Convenience hooks `useDailyPL/useWeeklyPL/useMonthlyPL` accept optional branchId.
- Pages pass `pinnedBranchId ?? activeBranchId ?? null` from `useBranch()`.

## UI
- ChartOfAccountsManager: per-row `GitBranch` icon → `CreateBranchSubAccountsDialog` creates children under a parent for each selected branch, auto-assigning next free code within the parent's type range. Naming pattern: `"<parent name><separator><branch name>"` (default separator " / ").
- `ExportCoATemplateButton` exports CoA (parent linked via `parent_account_code`) + accounting_account_mappings as JSON or CSV for seeding other tenants.
- `BranchCashClosureSummary` (Shifts page → "Branch closure" tab): aggregates `shifts` + `cash_events` grouped by branch for a date range, shows opening/sales/drops/expected/actual/variance, and exports CSV. Backs the 11–11 cash-day review flow.
- `BranchReconciliationView` (Shifts page → "Branch closure" tab, below the summary): compares the same drawer totals against branch-filtered `account_transactions` for the period. Cash accounts are detected by `account_code` prefix `1010` or name ILIKE `%cash%`; revenue by `account_type='revenue'`. Variance highlights any drawer-vs-ledger drift before closing the period.
- FinanceDashboard now has an "Export P&L CSV" button that snapshots the active branch + period.
- TrialBalance CSV/PDF embed the branch scope (`All branches` or branch name) in the header and filename.

## Schema additions (branch_id)
- `overhead_allocation`, `overhead_payments`, `cogs_purchases`, `staff`, `payroll_records` all gained nullable `branch_id` (FK → branches, ON DELETE SET NULL). Indexes: `(restaurant_id, branch_id[, period_col])`.
- The `auto_stamp_account_tx_branch` BEFORE INSERT trigger also resolves branches from `cogs_purchases`, `payroll_records`, and `overhead_payments` reference rows. Historical account_transactions were backfilled.

## Per-branch account visibility (opt-in)
- New table `account_branch_visibility (account_id, branch_id, tenant_id)`. Empty for an account = visible to all branches (back-compatible default). One or more rows = visible only to listed branches.
- Helper `public.is_account_visible_for_branch(_account_id, _branch_id)` returns true for NULL branch (consolidated view) or when the visibility set is empty.
- App: `useAccountBranchVisibility` (read/write) and `useAllAccountBranchVisibility` (tenant-wide map). `useChartOfAccounts` now exposes `visibilityIndex`, `visibleBranchIdsFor(id)`, `isVisibleForBranch(id, branchId)`, `accountsForBranch(branchId)`.
- UI: `ChartOfAccountsManager` row has an Eye/EyeOff button → `AccountBranchVisibilityDialog` (toggle "restrict to specific branches" + per-branch checkboxes). Empty save clears restriction.
- Expense entry (`RecordExpenseDialog`) filters its CoA picker via `visibleExpenseAccounts` against the active branch.
- Reports apply the same filter at the row level: `TrialBalance` rows, `TransactionLedger` account filter, `AccountDrillDown` account picker.
- Exports embed the active branch scope: TrialBalance CSV adds `Branch,<name>` header and branch suffix in filename. TransactionLedger adds an "Export CSV" button with branch header, branch column, and branch suffix.

## Expense ledger balance validation
- `post_expense_to_ledger` tags both legs with a shared `batch_id`.
- Deferred constraint trigger `trg_validate_expense_ledger_balance` on `account_transactions` enforces that all non-voided rows for a given `(reference_type='expense', reference_id)` net to zero at commit; unbalanced inserts/updates/deletes raise `LEDGER_UNBALANCED`.
- RPC `reconcile_expense_ledger(p_tenant_id)` scans posted expenses, backfills the missing credit leg (Cash 1000 if paid, AP 2000 if unpaid) when DR > CR, and flags rows where CR > DR or the counter-account is missing.
- UI: `useExpensePostingStatus(expenseId)` + `ExpensePostingStatusPanel` show a posted / balanced / unbalanced badge and the linked DR/CR rows inside the Edit Expense dialog. The Expenses page toolbar has a manager-only "Reconcile ledger" button that calls the RPC and toasts the backfilled/flagged counts.
## Journal entry branch safeguard (DB-level)
- `validate_journal_batch_branch()` BEFORE INSERT/UPDATE on `journal_entry_batches`:
  - NULL branch_id → auto-fills when the tenant has exactly one active branch; otherwise raises `BRANCH_REQUIRED` for pending/unposted entries. Already-posted automated batches with no resolvable branch (legacy COGS true-ups) are allowed through and stay consolidated-only.
  - Raises `BRANCH_INVALID` / `BRANCH_TENANT_MISMATCH` / `BRANCH_INACTIVE`, and `BRANCH_LOCKED` when changing the branch of an approved or posted entry.
- `enforce_journal_line_branch()` BEFORE INSERT/UPDATE on `account_transactions`: lines with a `batch_id` inherit the batch's branch; a conflicting branch raises `BRANCH_LINE_MISMATCH`.
- RLS insert/update policies on `journal_entry_batches` use `can_write_journal_branch(branch_id)` (strict — NULL is rejected), unlike the read policy which still allows NULL for legacy visibility.
- `post_day_end_adjustment_to_ledger` and `reverse_day_end_adjustment` stamp `branch_id` on the batch, the ledger lines, and the mirrored reversal adjustment.
