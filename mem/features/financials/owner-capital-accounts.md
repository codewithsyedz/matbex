---
name: Owner / Partner Capital Accounts
description: Equity-head partner bank accounts (Partner - Bank ..1234) with capital injections/withdrawals posted to the ledger, branch-scoped, at /accounting/owner-capital
type: feature
---

## Schema
- `owner_capital_accounts` — partner_name, bank_name, account_last4 (4 digits), branch_id (NULL = shared), equity_account_id (FK chart_of_accounts, equity), opening_balance, is_active.
- `capital_movements` — capital_account_id, counter_account_id (business cash/bank asset), movement_type `injection|withdrawal`, movement_date, amount, reference_number, batch_id, is_reversed/reversed_at/reversal_reason.
- RLS via `can_manage_capital(tenant_id)` (owner/manager/accountant/superadmin) and `can_reverse_capital(tenant_id)` (owner/accountant/superadmin).

## RPCs
- `create_owner_capital_account(...)` — auto-creates the equity CoA account in code range **3401–3499**, named `"<Partner> - <Bank> ..<last4>"`.
- `post_capital_movement(...)` — creates a posted, approved journal batch + balanced legs:
  - injection: DR business cash/bank, CR partner capital
  - withdrawal: DR partner capital, CR business cash/bank
- `reverse_capital_movement(id, reason)` — posts a mirrored reversal batch and flags the movement. Never delete.

## UI
- `/accounting/owner-capital` (`src/pages/OwnerCapital.tsx`, hook `src/hooks/useOwnerCapital.ts`), sidebar under Reports → "Owner Capital".
- Branch filter via `BranchScopeSelector`; date range; KPI cards (opening / injections / withdrawals / closing); accounts + movements tabs; CSV export for both.
