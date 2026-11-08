---
name: Multi-Branch Phase 1
description: Branches table foundation, primary branch auto-created per tenant, Settings UI only - operational tables not yet scoped
type: feature
---
Phase 1 delivered (2026-05-18):
- `public.branches` table: name, code, address, phone, timezone, is_primary, is_active, deleted_at
- Trigger `protect_primary_branch` blocks deletion/demotion of the primary branch
- Unique partial indexes: one primary per tenant, unique lowercase code per tenant
- Helper: `public.can_access_branch(_branch_id uuid)` SECURITY DEFINER
- Backfill: every existing restaurant got a "MAIN" primary branch
- UI: Settings → Branches tab (owners/managers) via `src/components/settings/BranchManager.tsx`
- RLS: tenant members read; owners/managers insert/update; soft delete only

NOT YET DONE (Phase 2+): scoping sales_transactions, shifts, cash_events, inventory_items, purchases, journal_entries, expenses by branch_id. pos-sync edge function still uses restaurant_id as branch.
