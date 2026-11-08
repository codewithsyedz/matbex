---
name: Per-supplier AP heads
description: Unpaid supplier expenses credit an auto-created supplier payable account (2500-2899) under 2000 Accounts Payable
type: feature
---
- `suppliers.ap_account_id` links each supplier to its own Chart of Accounts payable head.
- `resolve_supplier_ap_account(tenant_id, supplier_id)` returns/creates `AP - <Supplier Name>` as a child of 2000, allocating the next free code in 2500-2899.
- `post_expense_to_ledger`: unpaid expense with a supplier credits the supplier head; without a supplier it falls back to branch-resolved 2000.
- `reclassify_expense_credit_account`: settlements/reversals debit/credit the supplier head; open balance is summed across the supplier head, branch child, and parent 2000 (legacy postings).
