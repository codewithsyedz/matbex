# Expense drill-down on Profit & Loss

## Build
- Add a secure ledger report query that returns each posted expense movement for the selected tenant, date range, branch, and accessible branches only.
- Match expense movements to the exact P&L expense account, preserving amendments and reversals so detail totals reconcile to the account row.
- Make expense account rows expandable. Show date, description, payment method, reference, and the signed ledger amount beneath each account.
- Keep non-expense ledger adjustments in a separate summarized remainder so the visible detail never misrepresents the P&L total.
- Add loading, empty, error, mobile, English, Arabic, and RTL states.
- Include expense detail in the P&L CSV export.

## Technical details
- Source amounts from immutable `account_transactions`, not the editable expense amount, because VAT splits, amendments, credits, and reversals must match the P&L exactly.
- Join `expenses` only for descriptive metadata and use the existing tenant/branch authorization checks in the current P&L report.
- Validate that each expanded account's displayed movement total equals its P&L account amount for the same branch and period.
