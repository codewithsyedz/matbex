---
name: Multi-Branch Phase 2
description: branch_id column on operational tables with auto-stamp trigger, branch-aware dashboard RPCs, hooks filter by activeBranchId
type: feature
---
Phase 2 delivered (2026-05-18):

DB:
- Added nullable `branch_id` (FK to branches.id) on: sales_transactions, sales_items, shifts, cash_events, drawers, shift_templates, expenses, inventory_items, purchases, purchase_invoices, staff_advances, pos_terminals
- Backfilled all existing rows to the tenant's primary branch
- `auto_stamp_branch_id` BEFORE INSERT trigger on every table above: fills branch_id from primary branch when NULL, raises if branch_id doesn't belong to row's restaurant
- `staff.assigned_branch_id` (nullable FK) to pin cashiers to a branch
- New helpers: `get_primary_branch_id(restaurant_id)`, `user_pinned_branch_id(user_id, restaurant_id)`
- `dashboard_sales_summary` and `dashboard_expense_summary` now accept optional `p_branch_id` parameter (NULL = all branches)

NOT YET branch-scoped:
- `journal_entry_batches` (uses tenant_id not restaurant_id - needs separate strategy)
- `recipes`, `menu_items`, `customers`, `chart_of_accounts` - intentionally stay tenant-wide per Phase 1 decision

App:
- `useDashboardData`, `useShiftsData`, `useDailySales` now read `activeBranchId` from `useBranch()` and apply `.eq('branch_id', ...)` when set
- `BranchSwitcher` in AppHeader (hidden until tenant has >1 branch)
- BranchManager copy updated to reflect scoping is live

Pattern for new code:
```ts
const { activeBranchId } = useBranch();
let q = supabase.from('X').select('*').eq('restaurant_id', rid);
if (activeBranchId) q = q.eq('branch_id', activeBranchId);
```
Inserts can omit branch_id - trigger fills it.
