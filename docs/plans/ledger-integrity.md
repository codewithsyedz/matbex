# Ledger integrity: journal header, balance invariant, append-only lines

Status: proposed (2026-11-26). This is item #1 in `docs/research/matbex-vs-wafeq.md`.

## What the data says (staging = copy of production, 2026-11-10 export)

These are read-only queries against `account_transactions` and `chart_of_accounts` on staging (3 tenants, 12,997 lines):

| Check | Result |
|---|---|
| Postings (grouped by tenant + `reference_type` + `reference_id`/`batch_id`) that don't balance, all lines counted | 348 of 3,465, all `expense`, Σ\|diff\| SAR 65,873.12 |
| Same, **excluding voided lines** | **0**; trial balance = **0.00** |
| Cause of the 348 | 3-line expense postings: Dr expense/inventory, Cr AP, Cr Cash. The AP leg was voided by flag: `void_reason` = "Reclassified expense counter-account: expense payment status" (342) / "backfill paid expenses" (11) |
| `chart_of_accounts.balance` vs live ledger | **25 accounts drift, Σ\|drift\| SAR 735,876.52.** For example, Cash in Hand stored −151,355.79 vs ledger +142,475.07; Accounts Payable stored 221,542.86 vs ledger −7,129.31. 22 accounts drift even when voided lines are included, so something else changed the column too (imports or direct writes) |

So the books are correct. The problems are in the structure around them:

1. **The stored balance is wrong, and owners can see it.** `update_account_balance()` fires on INSERT only: it ignores voids and deletes, and is not reconciled. The Chart of Accounts screen shows it (`src/components/accounting/ChartOfAccountsManager.tsx:395,450`). Reports (TB, BS, P&L, cash flow) compute from lines with `is_voided` filtered, so they are right.
2. **"Balanced" depends on every reader remembering `is_voided`.** Voiding mixes two models: flag only (expense reclassification) and flag + reversal line (`void_transaction`). Some hooks that read ledger lines don't filter `is_voided`: `useCardSettlementClearing.ts`, `useInstallmentReconciliation.ts`, `useChartOfAccounts.ts`. Each needs checking.
3. **Browsers can insert ledger lines directly.** The RLS insert policy is `can_post_journal_entries(tenant_id)`.
   - The manager path in `src/hooks/useJournalEntries.ts:150-200` inserts a batch already marked `is_posted`, then inserts the lines in a second request. Balance is checked only in the browser, and a failed second request is "rolled back" by the browser deleting the batch.
   - `useAccountTransactions.ts` has a single-line `createTransaction` (unused, but the REST path is open to anyone holding that permission).
4. **No entry header, number or invariant.** 63 SQL functions insert ledger lines (the `post_*` functions, reversals, reclassifications, VAT corrections, installments). 8 update them (`void_transaction`, `post_card_settlement_deposit`, `post_vat_remittance`, `void_vat_remittance`, `realign_advance_branch`, `reverse_provisional_cogs_for_sale_item`, `reverse_staff_advance_ledger`, `undo_project_transaction_posting`). None delete. Expenses are the only type with a DB-side balance check (`trg_validate_expense_ledger_balance`).

## Plan

Three phases, each shippable on its own and in this order.

### Phase A: correct account balances (S, ~2–3 days): **built 2026-11-26, not yet deployed**

What shipped:

- `db/migrations/20261126064155_ledger_account_balance_from_lines.sql`:
  - The ledger trigger now handles insert, void, account move and delete.
  - A guard on `chart_of_accounts` ignores every other write to `balance`. That covers the four functions that wrote it by hand, as well as imports. New accounts start at 0.
  - `recompute_account_balances()` (service role only) rebuilds the column and logs each correction in `account_balance_recompute_log` (RLS: read-only for tenant members). The migration runs it once.
  - A dry run on the staging production copy, rolled back, corrected exactly the 25 accounts / SAR 735,876.52 and left 0 drift.
- `db/migrations/20261126085723_void_transaction_flag_only.sql`: `void_transaction` used to flag the original **and** post a swapped reversal. Every reader that skips voided lines therefore counted the void twice. It now voids by flag only. The production copy has no rows from the old path.
- `server/functions/ledger-balance-check` runs nightly at 03:15 Riyadh (`server/src/jobs/schedules.ts`) and is listed in admin jobs.
- `useCardSettlementClearing` now skips voided lines. `useInstallmentReconciliation` already did, in `src/lib/installmentRecon.ts`.
- `server/src/modules/ledger/account-balance.db_test.ts` is part of `test:db`.
- Correction to the findings above: hard deletes of ledger lines were already refused (`prevent_locked_period_modifications`), so append-only work in Phase C is about UPDATEs only.
- Still open: voiding one line from the ledger screen (`TransactionLedger.tsx`) leaves the other side of its entry live. Phase B's reverse route should void or reverse whole entries and replace the per-line button.

Original plan:

- Migration `ledger_account_balance_from_lines`:
  - Replace `update_account_balance()` with an AFTER INSERT OR UPDATE OF (debit, credit, account_id, is_voided) OR DELETE trigger that applies the live-line delta (voided lines count as 0).
  - One-off recompute: `UPDATE chart_of_accounts c SET balance = live sum` for every account. Record before/after in an audit table, `account_balance_recompute_log`, so the 25 corrections stay traceable.
- Add the stored-vs-ledger comparison to `nightly-invoice-ledger-scan` (or a `tasks` queue job in `server/src/jobs/schedules.ts`) so drift raises an incident instead of hiding.
- Audit the hooks that read `account_transactions` without `is_voided`, and fix the ones that sum amounts.
- Tests: a DB test that inserts, voids by flag, voids with a reversal and checks `balance` = live sum.

### Phase B: manual journals move server-side; close browser ledger writes (M, ~1–2 weeks): **built 2026-11-26, not yet deployed**

What shipped:

- `server/src/modules/ledger/` (schema → routes → service → repository). Three routes:
  - `POST /api/v1/ledger/journal-entries`: checks balance to the cent, one side per line, active accounts of the business, branch access and an open period. Owners and managers post directly. Accountants go through `submit_pending_journal_entry`, so the approval queue and notifications are unchanged.
  - `POST /api/v1/ledger/journal-entries/:id/void`: owner/manager. Voids every line of the entry while its period is open.
  - `POST /api/v1/ledger/journal-entries/:id/reverse`: owner/manager. Posts a mirror entry (`journal_entry_reversal`, each line linked through `original_transaction_id`) dated today or in another open period.
  - Both refuse supplier-payment batches (`EXPPAY-…`), postings from other flows (`not_manual_entry`), and entries already voided or reversed. Database refusals come back as 4xx codes, not 500s.
- `useJournalEntries` calls the API. `TransactionLedger` voids or reverses the whole entry and requires a reason. In a locked period it offers "Reverse in current period" instead. Lines posted by other flows show a tooltip pointing to their source document. The dead single-line insert helpers in `useAccountTransactions` were removed.
- `db/migrations/20261126114729_ledger_close_browser_writes.sql` drops the browser INSERT policy on `account_transactions` and the INSERT/UPDATE policies on `journal_entry_batches`, and revokes write grants from `anon` and `authenticated`. Every other ledger writer is a SECURITY DEFINER function. The one invoker function, `post_customer_credit_to_ledger`, is called only by the credit module.
- Tests: `server/src/modules/ledger/ledger.db_test.ts` (6) covers posting, invalid input, void, reverse, locked periods and roles. End-to-end over HTTP on the local API: 400 for an unbalanced entry, post/void/reverse move the balance as expected, 409 on a second void, and `permission denied` for a direct browser insert.
- Not done here: idempotency keys on posting (the form disables the button while pending), and the UX review's suggestions to void from P&L/account drill-downs and source documents (`docs/research/accounting-ux-review.md`, P9).

Original plan:

- New domain module `server/src/modules/ledger/` (schema → routes → service → Drizzle repository, `requireRestaurantRole`, scoped by tenant). Two routes:
  - `POST /api/v1/ledger/journal-entries`: one DB transaction. It checks balance server-side and keeps the approval rules: non-managers → pending (same semantics as `submit_pending_journal_entry`), managers → posted. It is idempotent by client key.
  - `POST /api/v1/ledger/journal-entries/:id/reverse`: posts a reversal entry and never edits lines.
- Move `JournalEntryForm`, `TypedJournalEntryForm` and `InventoryPurchaseForm` to it through `src/lib/api/`.
- Migration: drop the browser INSERT policy on `account_transactions` and the browser INSERT/DELETE on `journal_entry_batches`, then revoke the matching grants from `authenticated`. Delete the unused `createTransaction`/`createBatchTransactions`.
- Then the ledger is written only by SECURITY DEFINER functions and `/api/v1`, which matches the AGENTS.md rule for sales.

### Phase C: journal header + deferred balance invariant + append-only (M–L, ~2–3 weeks): **built 2026-11-26, log mode, not yet deployed**

What shipped (`db/migrations/20261126121749_journal_entry_headers_and_integrity.sql`):

- **Headers:** `journal_entries` has one header per posting, keyed `(tenant, reference_type, reference_id else batch_id else line)`, the same grouping the reports use. `account_transactions.entry_id` points at it.
  - A BEFORE INSERT trigger stamps new lines, so none of the posting functions changed.
  - Existing lines were backfilled with user triggers disabled (table owner only; foreign keys stay on).
- **Entry numbers:** gap-free per tenant, assigned by `number_journal_entries()` from the hourly `ledger-balance-check` job (now `15 * * * *`), not while posting. Assigning them while posting would make POS sales in one business wait on a counter. New entries get their number within the hour, in the order they were created (`clock_timestamp()`).
- **Balance check:** a deferred constraint trigger checks at commit that each touched entry's non-voided lines balance to the cent.
- **Edit guard:** a BEFORE UPDATE trigger allows only voiding, stamping `entry_id`, and filling a NULL `reference_id` (card settlement deposits and VAT remittance do this). Anything else is a `line_update`, and un-voiding is an `unvoid`.
- **Log mode first:** both checks write to `ledger_integrity_violations` (RLS: read-only for tenant members) and let the transaction through. `ledger-balance-check` reports the last 24 hours. Switch them on with `update ledger_integrity_settings set enforce_balance = true` and `enforce_append_only = true` once the log stays empty.
  - Expected entries in the log: `realign_advance_branch` (rewrites `branch_id`), CoA migration account moves, and any legacy single-line `void_transaction` call.
- **Dry run on the staging production copy** (rolled back): 3,465 headers, all 12,997 lines stamped, 0 unbalanced entries, numbers gap-free, about 4 seconds.
- `db/post-copy-repairs.sql` repeats the Phase A recompute and the Phase C backfill after the cutover data copy.
- Tests: `server/src/modules/ledger/journal-integrity.db_test.ts` (5) covers shared headers, gap-free numbering, log versus enforce for balance, and allowed versus refused edits.

Original plan:

- `journal_entries` (id, tenant_id, branch_id, `entry_number` gap-free per tenant, entry_date, source_type, source_id, batch_id, status, reversal_of, created_by/at). Add the column `account_transactions.entry_id`.
- **No change to the 63 posting functions.** A BEFORE INSERT trigger on `account_transactions` finds or creates the header for `(tenant_id, reference_type, coalesce(reference_id, batch_id))` within the current transaction and stamps `entry_id`. The functions can adopt explicit headers gradually.
- `CONSTRAINT TRIGGER … DEFERRABLE INITIALLY DEFERRED` per touched entry: Σdebit = Σcredit over non-voided lines at commit.
  - **Rollout is log-only first.** Violations go to `ledger_balance_violations` for 1–2 weeks on staging, then enforce. Some flows may post their legs in separate transactions, and the data can't show that.
- Append-only: a BEFORE UPDATE trigger allows only the void transition (`is_voided` false→true plus `voided_at/by`, `void_reason`), and BEFORE DELETE always raises. Review each of the 8 updating functions:
  - `realign_advance_branch` changes `branch_id`; rewrite it as a reversal and repost, or allow-list it explicitly.
  - Check what `post_card_settlement_deposit` and `post_vat_remittance` update.
  - The superadmin bypass of `enforce_fiscal_period_lock` stays but is audited.
- Pick one void model going forward: **reversal entries only** (a flag is set on the original for display, and both entries stay live and net to zero). Readers then stop needing `is_voided` for correctness. Existing flag-only voids stay as they are, because history isn't rewritten.
- Backfill: create headers for existing groups. The staging check shows every group balances over non-voided lines, so enforcement can start clean.
- Gives auditors entry numbers and gives the Wafeq/Qoyod connector (#6) a stable idempotency key per entry.

## Risks / open points

- Phase C enforce mode could block a posting flow that today commits in two steps. That's why log-only comes first.
- Phase A's recompute changes numbers owners see on the COA screen, and the new numbers are the ones that match the reports. A one-line note in the release is worth it.
- The 22 accounts that drift even counting voided lines suggest direct writes in the migration/import path (`migration-commit`, Lovable restore). Confirm the import path doesn't write `balance`.
