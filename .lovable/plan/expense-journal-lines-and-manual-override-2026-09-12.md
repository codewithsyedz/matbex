# Expense Journal Lines and Manual Override

## Goal
Add a per-expense journal view that clearly shows every debit and credit, identifies the AI-selected account and confidence, and lets authorised finance users correct the selected debit account without editing posted ledger rows in place.

## User experience
- Add a “Journal” action to each expense row and expense details view.
- Open a compact, scrollable dialog showing posting status, AI classification, confidence, rationale, and balanced debit/credit lines.
- Label each line as Debit or Credit and show account code, account name, amount, and whether it was AI-selected or system-generated.
- Add a “Manual override” action for owner, manager, accountant, and Super Admin users.
- For unposted expenses, the override selects an eligible branch-visible debit account and posts through the existing guarded ledger path.
- For posted expenses, the override requires a reason and uses an immutable reversal-and-repost correction instead of editing journal rows.
- Show clear loading, empty, low-confidence, blocked, success, and permission states in English and Arabic/RTL.

## Backend and accounting safeguards
- Add secure read functions for one expense’s journal lines and latest AI audit result, scoped by tenant, restaurant, and branch access.
- Add a secure manual-override function that validates role, account eligibility, branch visibility, fiscal locks, and balanced output.
- Record override actor, reason, original account, replacement account, confidence, and resulting transaction reference in the audit trail.
- Preserve idempotency and the immutable-ledger rule: posted entries are reversed and replaced, never edited or deleted.

## Frontend implementation
- Create a reusable expense journal dialog and account override form using existing table, dialog, select, badge, and button components.
- Integrate it into the main Expenses table and approval/detail surfaces.
- Refresh expenses, account transactions, Trial Balance, Profit & Loss, and journal queries after an override.

## Verification
- Validate debit and credit totals match for posted expenses.
- Test an unposted low-confidence suggestion and a posted expense correction with authorised access.
- Verify permission denial, branch isolation, duplicate submission protection, Arabic RTL, dark/light themes, mobile layout, typecheck, focused tests, and production build.
