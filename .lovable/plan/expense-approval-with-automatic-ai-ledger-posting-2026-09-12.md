# Expense approval with automatic AI ledger posting

## Goal
Make approval the single control point: when an owner or manager approves an expense, Matbex selects the debit account with AI and posts the balanced entry automatically. Rejections never post.

## Implementation
- Add a server-side approval-and-post function that validates the approver, locks the expense, records approval once, and invokes the existing guarded AI journal flow.
- Keep AI constrained to the eligible account catalogue. VAT, payment account/AP credit, branch routing, balancing, permissions, period locks, and ledger mutation remain deterministic.
- Update single and bulk approval actions to use this workflow instead of directly posting the expense’s existing account.
- Treat already-approved or already-posted expenses idempotently so retries cannot duplicate ledger entries.
- If AI confidence is below the automatic threshold or required payment information is missing, keep the expense approved but visibly unposted, return the exact reason, and preserve the AI audit event for follow-up.
- Refresh expense, approval, ledger, chart-of-accounts, trial-balance, and reporting data after approval.
- Update approval feedback so single and bulk actions distinguish posted, approved-but-needs-review, and failed items.

## Verification
- Test one approved expense through the deployed function and confirm one ledger transaction plus its AI audit record.
- Test a repeated approval to confirm no duplicate posting.
- Test low-confidence or incomplete data to confirm approval persists, no ledger mutation occurs, and the reason is shown.
- Run focused tests, typecheck, build, and inspect preview errors.
