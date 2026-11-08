---
name: Branch-Based Access Control
description: Owners/managers see all branches; non-managers pinned via staff.assigned_branch_id are locked to one branch in UI + RLS
type: feature
---
Phase 3 (2026-05-18):

DB:
- `user_can_access_branch(_user, _restaurant, _branch)` SECURITY DEFINER: true for owner/manager, true if branch matches `staff.assigned_branch_id`, true if user has no pinning row (back-compat).
- Restrictive RLS policy `"Branch pin restriction"` added on: sales_transactions, sales_items, shifts, cash_events, drawers, expenses, inventory_items, purchases, purchase_invoices, staff_advances, pos_terminals. Layered on top of existing permissive policies.
- `auto_stamp_branch_id` trigger updated: when branch_id NULL, prefers `user_pinned_branch_id` over primary; when provided, raises 42501 if caller can't access that branch.

App:
- `useBranch()` exposes `pinnedBranchId` and `canSwitchBranches`. Pinned users get their branch forced as activeBranchId; localStorage and "All" are ignored.
- `BranchSwitcher` renders a read-only chip with Lock icon when `!canSwitchBranches`.
- `StaffManager` add/edit dialog has a "Branch Access" Select (only when tenant has >1 branch). Saved to `staff.assigned_branch_id`. List view shows Branch column.
