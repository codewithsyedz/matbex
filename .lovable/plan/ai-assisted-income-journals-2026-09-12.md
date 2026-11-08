# AI-assisted income journals

## Goal
Add the expense flow’s guarded AI account selection to income while keeping every amount, VAT calculation, payment account, branch, and balancing line under deterministic accounting rules.

## Build
- Add an income-journal audit trail for daily sales and customer receipts, restricted to finance roles and the correct tenant.
- Add a secure posting function that accepts only active, branch-visible revenue accounts from the restaurant’s chart of accounts.
- Extend daily sales posting so AI may classify the revenue account while existing rules continue to debit Cash in Hand, Card Clearing, or Accounts Receivable and credit VAT Payable separately.
- Make customer receipts post automatically as Debit Cash/Bank and Credit Accounts Receivable. AI will classify only genuine miscellaneous-income receipts; it will not reclassify settlement receipts that clear an existing receivable.
- Add an income AI function using Lovable AI, a confidence threshold, preview support, bounded retry only for rate limits/server failures, and visible gateway errors.
- Trigger the guarded flow after an eligible sales day closes and after a customer receipt is recorded, while preserving idempotency and the existing manual recovery controls.
- Show the selected account, confidence, rationale, posting status, and actionable failures in the current sales/ledger interfaces.

## Accounting and security rules
- The AI can choose only from supplied active revenue accounts; it cannot invent IDs, amounts, tax, branches, payment accounts, customers, or ledger lines.
- Sales remain gross-to-net: deterministic code calculates output VAT and produces a balanced batch.
- Customer settlement receipts always clear Accounts Receivable; they are never recognized as revenue twice.
- Posting locks the source row, verifies finance permissions and restaurant access, and rejects already-posted records.
- Every result is auditable as posted, blocked, or failed.

## Verification
- Validate migration permissions, row-level access, balance checks, duplicate prevention, and branch account visibility.
- Test one closed sales day and one customer receipt end to end, confirming balanced debit/credit lines, VAT treatment, selected accounts, audit records, and no duplicate posting on replay.
- Run typecheck, build, and focused interface checks in both themes and Arabic RTL where controls appear.
