# AI-assisted expense journal posting

## Goal
Turn an expense description into a complete, balanced journal entry using the restaurant’s own chart of accounts, then post it automatically only when every deterministic accounting and security check passes.

## What will be built
- Add an authenticated `generate-expense-journal` backend function using Lovable AI Gateway and the default `openai/gpt-6-astra` Responses API.
- Send only the expense facts and the active, branch-visible account catalogue to AI; require account IDs from that supplied catalogue.
- Have AI classify the expense, choose the debit account, explain its choice, and return a confidence score. Cash/bank/AP, VAT, branch routing, totals, and balancing remain deterministic rather than AI-selected.
- Validate the AI result server-side: caller role and tenant access, expense approval, posting state, branch visibility, account existence/type, cost-center rules, VAT values, and confidence threshold.
- Automatically apply the selected account and call the existing `post_expense_to_ledger` procedure, preserving its balanced batch, immutable ledger, VAT split, supplier AP, funding-account, and audit safeguards.
- Refuse automatic posting when confidence or validation is insufficient. Return the exact reason without writing partial ledger rows.
- Record AI provenance in a tenant-scoped audit table: expense, chosen account, confidence, rationale, model/prompt version, outcome, error, actor, and resulting ledger batch/transaction reference.
- Add an “AI journal” action to the expense workflow with posting progress and a clear posted/blocked result. Refresh expenses, ledger reports, and reconciliation data after success.
- Add English and Arabic labels and preserve RTL, dark/light themes, and the clinical-precision layout.

## Safety and accounting rules
- AI never inserts ledger rows directly and never invents an account.
- Actual posting remains atomic through the existing database procedure; debit must equal credit before commit.
- Only owner, manager, accountant, or superadmin roles may trigger automatic AI posting.
- Already-posted, rejected, inaccessible, cross-tenant, locked-period, invalid-account, or ambiguous expenses are rejected.
- Paid expenses still credit the explicitly selected Cash in Hand, Cash in Bank, Petty Cash, or valid capital account. Unpaid expenses still credit supplier AP/general AP.
- AI Gateway 400/401/402/403 errors are surfaced and not retried. Only 429/5xx receive bounded delayed retries.

## Technical implementation
- Create a migration for the AI posting audit table, explicit grants, RLS policies, indexes, and any narrow RPC needed for atomic account-selection plus posting.
- Add shared Responses API gateway helpers under the backend functions area, with run-ID propagation and server-only key use.
- Use streaming structured output with a strict-compatible schema, `store: false`, reasoning enabled, and no request timeout.
- Update the expense UI and translations without changing unrelated expense creation or settlement flows.
- Deploy the function and run one real authenticated AI request through the exact route. Verify database audit output, a balanced journal batch, expense posting state, typecheck, build, and Arabic/English UI behavior.
