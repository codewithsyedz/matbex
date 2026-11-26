# Matbex accounting vs Wafeq: a platform-engineer comparison

Date: 2026-11-26. Branch read: `custom-backend` at `a1d8c32`.

Sources for Matbex are the code and the local database built from `db/migrations` (inspected with `pg_policy`, `pg_trigger` and `information_schema`). Sources for Wafeq are its public pages, read on the same day:

- [home](https://www.wafeq.com/)
- [features](https://www.wafeq.com/en-sa/features)
- [pricing](https://www.wafeq.com/en-sa/pricing)
- [ZATCA](https://www.wafeq.com/en-sa/zatca-e-invoicing-saudi-arabia)
- [accountants](https://www.wafeq.com/en-sa/accountants)
- [accounting firms](https://www.wafeq.com/en-sa/accounting-firms)
- [integrations](https://www.wafeq.com/en-sa/integrations/directory), page 1 of 3 only
- [trust](https://www.wafeq.com/en-sa/trust)
- [developers](https://www.wafeq.com/en-sa/developers)
- [API docs](https://docs.wafeq.com/)
- the API index at [wafeq.readme.io/llms.txt](https://wafeq.readme.io/llms.txt)
- [rate limits](https://wafeq.readme.io/reference/rate-limits.md)

Wafeq's help centre (`help.wafeq.com`) returned 403 and could not be read. Anything marked **unverified** below was not confirmed on a page I could read. Wafeq claims are the vendor's own and were not tested in a Wafeq account.

---

## 1. Bottom line

- **The two products sit in different places.** Wafeq is a general-ledger product. Its users are accountants and SMEs who type invoices, bills and bank lines into it. Matbex is a restaurant operating system whose ledger is written *by the operation*: POS sales, COGS, waste, payroll, cash drawers, card settlements, aggregator settlements and day-end. For a restaurant, Matbex's books are closer to the truth on day one, and Wafeq's are only as good as the integration feeding them. Wafeq's Foodics connector syncs "revenue, products, inventory, tax rates".
- **Matbex is behind on the "accountant's desk" features**:
  - bank feeds and statement reconciliation;
  - general B2B invoicing (quotes, POs, debit notes, statements);
  - a multi-client practice for accounting firms, with consolidation and multi-currency;
  - Saudi payroll compliance (GOSI/WPS/Mudad/EOSB; Wafeq's coverage is also unverified);
  - a public, tenant-facing API with keys or OAuth.
- **Matbex has a structural ledger risk that Wafeq presumably does not.** Balance is not enforced per entry at the database level (section 4.1). Also, `account_transactions` has no header and entry number. Fix this before adding more posting sources.
- **Recommendation: don't try to out-Wafeq Wafeq.** Close the gaps an owner or accountant hits every month: bank reconciliation, entry integrity, the accountant practice view, AR statements and aging, and the KSA hosting story. Then ship a **Matbex → Wafeq/Qoyod export connector**, so restaurants whose external accountant insists on Wafeq stay on Matbex for operations instead of churning to Foodics + Wafeq. Matbex already has the pattern: `accounting_integrations` with providers `zoho_books`, `xero`, `quickbooks` and `smacc`, and the functions `quickbooks-sync` and `zoho-sync`.

---

## 2. Feature matrix

Legend: **Has** = built and reachable in the app; **Partial** = exists but narrower than Wafeq's equivalent, or restaurant-specific; **Missing** = not found in code. Wafeq status uses the same scale based on public pages; **?** = unverified.

### 2.1 Core ledger

| Capability | Matbex | Matbex evidence | Wafeq | Wafeq evidence |
|---|---|---|---|---|
| Chart of accounts (hierarchy, typed, code ranges) | Has | `chart_of_accounts` (`parent_id`, `account_type` enum asset/liability/equity/revenue/cogs/expense, code-range CHECK) in `db/migrations/20260125123801_*.sql`; branch visibility `account_branch_visibility`; mapping UI `src/pages/LedgerMapping.tsx`, `src/pages/CoaMigrationPreview.tsx` | Has | Accounts API (llms.txt) |
| Ledger lines | Has | `account_transactions` (debit, credit, `reference_type/id`, `batch_id`, `branch_id`, `project_id`, void columns). 15 triggers (tenant check, branch stamp, fiscal lock, cost centre, reversal linkage, installment VAT check) | Has | Manual Journals / Bank Ledger Transactions API |
| Manual journals with approval | Has | `journal_entry_batches` + `submit_pending_journal_entry`, `approve_journal_entry`, `reject_journal_entry`, `trg_enforce_journal_entry_approval_state`, notifications `trg_notify_journal_entry_pending/decision` | Has | "Choose who submits, approves and posts" (features) |
| Entry-level balance enforced in DB | **Partial** | Balance is enforced only for expenses (`trg_validate_expense_ledger_balance`). Other sources rely on each `post_*` function plus after-the-fact detectors: `detect_invoice_ledger_divergence`, `nightly-invoice-ledger-scan`, `run_daily_reconciliation` | ? (assumed) | — |
| Immutability / reversal-only corrections | Partial | No UPDATE/DELETE RLS policy on `account_transactions`, so the browser cannot edit lines. Void columns and `original_transaction_id` exist, with `trg_validate_reversal_linkage` and the `src/pages/ReversalAudit.tsx` UI. There is no append-only trigger, so SECURITY DEFINER code can still UPDATE or DELETE. `trg_protect_ap_settlement_transactions` covers AP only | ? | "document history" (features) |
| Period locks | Has | `fiscal_period_locks` with an unlock-request workflow; `lock_fiscal_period`/`unlock_fiscal_period`; `enforce_fiscal_period_lock` on ledger insert/update/delete; owner check in `20261119114011_lock_fiscal_period_owner_check.sql`; separate `payroll_period_locks` and locked stock movements | ? | not on pages read |
| Bulk reclassification | Missing | — | Has | "Reclassify journal entries in bulk", Sheet View (features, accountants) |
| Recurring journals / prepaid amortisation / revenue recognition | Partial | Monthly overhead accrual (`post_overhead_month_accrual`, `daily_overhead_*`) and depreciation runs. No generic recurring journal | Has | amortisation and revenue recognition (features) |
| Cost centres / projects / branches | Has | `projects`, `project_transactions`, `project_budget_lines`, `trg_enforce_account_cost_center`, `branch_id` on every line; P&L, BS and cash flow by branch | Has | Projects, Cost Centers, Branches API |
| Budgets | Partial | Project budgets only (`project_budget_lines`) | ? | — |
| Multi-currency | **Missing** | Ledger has no currency or FX columns. `get-exchange-rates` and `platform_currencies` are for display and billing | Has | "own currency"; CurrencyEnum; consolidation across SAR/AED/USD (accountants) |
| Multi-entity + consolidation | **Partial** | One tenant → many branches, with by-branch and all-branch reports (`get_*_by_branch`, `AllBranchesTotalsCard`). `profiles.tenant_id` is a single tenant, so there is no switching between companies and no cross-tenant consolidation | Has | "separate books for each company … one consolidated P&L" (features) |

### 2.2 Tax and ZATCA

| Capability | Matbex | Matbex evidence | Wafeq | Wafeq evidence |
|---|---|---|---|---|
| VAT accounts on every chart | Has | `20261112135750_input_vat_account_for_every_chart.sql`, `resolve_vat_account`, `ensure_input_vat_account` | Has | — |
| VAT return from the ledger | Has | `vat_returns` with ZATCA boxes 1–15 + adjustments, `sadad_number`, status; `vat_return_ledger_figures` (also reports unposted days, days without EOD, pending VAT split); `vat_return_adjustments_log`; `src/pages/VatReturn.tsx` | Has | "automatically generate your VAT return" (accountants) |
| VAT payment | Has | `vat_remittances`, `post_vat_remittance`, `void_vat_remittance` | ? | — |
| VAT integrity monitoring | **Has (stronger)** | `scan_sale_posting_vat_integrity`, `vat_posting_integrity_incidents`, `detect_vat_incident`, `suggest/apply_vat_posting_correction`, `installment_vat_mismatch_alerts`, `get_zatca_pl_reconciliation`, `src/pages/VatAudit.tsx`; POS VAT fix route `/api/v1/pos/sales/:id/vat-reconcile` | Partial | "Smart VAT monitoring" = a registration-threshold alert only |
| Expense VAT split / reversal | Has | `apply_expense_vat_split`, `reverse_expense_vat`, `mark_expense_vat_not_applicable`, `expense_vat_split_audit`, `src/pages/PendingVatSplit.tsx`; amendments via the correction RPC (`20261106214418_…0043_accountant_inventory_and_expense_corrections.sql`) | ? | — |
| ZATCA Phase 2: onboarding (CSR/CSID) | Has | `server/functions/zatca-onboard-device` (compliance → production CSIDs); `zatca_devices` (secrets locked, `20261110180818_*`) | Has | OTP onboarding from Fatoora (ZATCA page) |
| Simplified (B2C) reporting | Has | `invoices/reporting/single` in `zatca-submit-clearance`, `zatca-clearance-worker` + `zatca_clearance_queue`; type `0200000` in `src/lib/zatca/ubl.ts` | Has | ZATCA page |
| Standard (B2B) clearance | Has | `invoices/clearance/single`; type `0100000` | Has | ZATCA page |
| Credit notes / debit notes | Partial | Credit notes: `zatca-issue-credit-note`, `zatca_credit_notes`. Debit notes (383) are referenced only in the credit-note function, with no standalone flow | Has | Credit Notes, Debit Notes API |
| Hash chain + audit | **Has (stronger)** | `zatca-chain-integrity-check`, `zatca_audit_trail`, `zatca_audit_seq`, `zatca-audit-export`, `zatca-device-monitor`, `/api/v1/zatca/sales/:id/chain` and `/documents` (`server/src/modules/zatca/zatca.routes.ts`) | ? | status tracking "Processing/Reported" |
| Supplier invoice VAT matching | Has | `post_zatca_purchase_invoice`, `20261105224740_0039_zatca_match_supplier_vat.sql` | ? | — |
| Standalone e-invoicing API (for other systems) | Missing | — | Has | ZATCA API (docs.wafeq.com/zatca), plus UAE Peppol and Bahrain APIs |
| Zakat | Missing | no reference in code | Has (library) | "tax legislation library … Zakat" (accountants) |

### 2.3 AR, AP, expenses

| Capability | Matbex | Matbex evidence | Wafeq | Wafeq evidence |
|---|---|---|---|---|
| Customer credit / on-account sales | Has | `/api/v1/credit/*` (`server/src/modules/credit/credit.routes.ts`): settlement invoices, payments, sale payments, write-off, balance adjustments + revert; `recompute_customer_balance`; `post_customer_credit_to_ledger`, `trg_auto_post_customer_receipt` | Has | Invoices, Payments API |
| General B2B sales invoicing (non-POS) | Partial | `settlement_invoices` consolidate on-account POS sales (`generate-settlement-invoice`). No free-form invoice with arbitrary lines | Has | Invoices, Simplified Invoices |
| Quotes → invoice | Missing | — | Has | Quotes API, "Quote to cash" guide |
| Payment requests / pay links on invoices | Partial | Online-order Moyasar pay exists (`online-order-pay`), but nothing ties it to settlement invoices | Has | Payment Requests API |
| AR aging + customer statements | **Missing** | Aging exists only for BNPL instalments (`src/pages/BnplReport.tsx`). No AR aging or statement-of-account | ? | not on pages read |
| Dunning / reminders | Partial | Only `bnpl-overdue-reminders` | ? | — |
| Supplier bills (purchase invoices) | Has | `purchase_invoices`, `post_purchase_invoice_to_ledger`, `post_purchase_invoice_payment_internal`; header sync `20261112085212_*` | Has | Bills API |
| Purchase orders → bill | Partial | `reorder_requests` and `send-reorder-email` only | Has | Purchase Orders API |
| AP payments, aging, ledger | Has | `supplier_payments`, `post_supplier_payment_to_ledger`; pages `ApAging.tsx`, `SupplierLedger.tsx`, `SupplierApReconciliation.tsx`, `SupplierApHeadAudit.tsx`, `ApAuditTrail.tsx` | Has | Bills/Payments API |
| Expenses with approval + posting | Has | `expenses`, `auto_post_expense_on_approval`, `trg_guard_posted_expense_edit`, `expense_posting_audit`, `bulk_post_expenses`, `ExpenseLedgerReconciliation.tsx` | Has | Expenses API, approvals |
| Receipt/bill OCR | Partial | `scan-supplier-invoice` (AI via `_runtime/ai.ts`) + `invoice_scans`; AI journal drafts `generate-expense-journal`, `generate-income-journal` with audit tables | Has | "AI inbox" via email/WhatsApp, AI extraction (features) |
| Email/WhatsApp inbox for bills | Missing | — | Has | features |

### 2.4 Cash, bank, assets, payroll, inventory

| Capability | Matbex | Matbex evidence | Wafeq | Wafeq evidence |
|---|---|---|---|---|
| Bank and cash accounts | Partial | Banks are ordinary COA accounts (`is_cash_or_bank_account`). Cash drawers (`drawers`, `cash_events`, shift variance). No `bank_accounts` entity holding IBAN, currency or feed | Has | Bank Accounts API |
| Bank feeds | **Missing** | No Open Banking (Lean/Tarabut) and no MT940/camt/OFX import | Partial | Wio named; "leading banks" unnamed; Saudi banks **unverified** |
| Bank statement reconciliation | **Missing** | Closest: `card_settlement_deposits` + `CardSettlementClearing.tsx` (card/mada deposit clearing), `payments-reconciler`, `aggregator_settlements`, and a CSV statement import only for owner capital (`StatementCsvImportDialog.tsx`, `CapitalStatementMatch.tsx`) | Has | AI matching "tells you why"; reconcile endpoint; Bank Reconciliation Report (accountants) |
| Fixed assets + depreciation + disposal | Has | `fixed_assets` (methods, salvage, disposal gain/loss, funding source), `fixed_asset_classes`, `post_monthly_depreciation`, `run_automatic_monthly_depreciation`, `fixed_asset_disposals`; `FixedAssets.tsx`, `DepreciationReport.tsx` | Has | features |
| BNPL / instalment plans | **Has (unique)** | `installment_plans`, `installment_payments`, `pay_installment`, `reschedule_installment_plan`, `apply_installment_vat_correction`, `InstallmentReconciliation.tsx`, `BnplReport.tsx` | Missing (not seen) | — |
| Owner capital / partners | Has | `owner_capital_accounts`, `capital_movements`, `post_capital_movement`, `reverse_capital_movement`, project partners | ? | — |
| Payroll → ledger | Partial | `payroll_records`, `post_payroll_to_ledger`, `staff_advances` (+ deductions), `employee_fines` → instalments, `PayrollJournal.tsx`, `SalaryCalendar.tsx`, `overhead_accrual_payroll_payable` | Has | Employees, Payslips, Pay Items API |
| GOSI / WPS / Mudad / EOSB | Missing | not in code | ? | **unverified**, not on any page read |
| Inventory + COGS | **Has (stronger for F&B)** | Recipes → `recipe_ingredients`. COGS has three layers: a provisional per-sale-line trigger (`trg_sales_items_after_insert_cogs`), stocktake true-ups (`post_stock_count_true_up`, `cogs_trueup_*`) and waste (`trg_auto_post_waste_to_ledger`). Also `inventory_batches`, `inventory_valuations` | Has (generic) | warehouses, WAC/FIFO, manufacturing BOM (features) |

### 2.5 Reports

| Report | Matbex | Evidence | Wafeq |
|---|---|---|---|
| P&L (by branch, by channel, expense drill-down) | Has | `get_profit_loss_by_branch`, `ProfitLoss.tsx`, `ChannelPnL.tsx`, `get_profit_loss_expense_lines` | Has |
| Balance sheet | Has | `get_balance_sheet_by_branch`, `BalanceSheet.tsx` | Has |
| Cash flow | Has | `get_cash_flow_by_branch`, `CashFlow.tsx` | Has |
| Trial balance | Has | `TrialBalance.tsx` | Has |
| General ledger / account drill-down | Has | `BranchLedger.tsx`, `AccountDrillDown.tsx` | ? |
| VAT return | Has | `VatReturn.tsx` | Has |
| AP aging | Has | `ApAging.tsx` | ? |
| AR aging | Missing | — | ? |
| Restaurant reports (daily profit, prime cost, sales journal, item breakdown, cash/card, day-end matrix, reconciliations) | **Has (unique)** | `DailyProfit.tsx`, `SalesJournal.tsx`, `SalesItemBreakdown.tsx`, `CashCardAnalysis.tsx`, `DayEndStatusMatrix.tsx`, `DailyReconciliationReport.tsx`, `InvoiceLedgerReconciliation.tsx` | Missing |
| Scheduled / emailed reports | Has | `report_schedules`, `send-scheduled-reports`, `email-report-pdf` | ? |
| Consolidated multi-company | Missing | — | Has |
| Count | ~40 routes under `/reports` and `/accounting` (`src/components/AnimatedRoutes.tsx`) | | "over 40" (home) |

### 2.6 People, workflow, platform

| Capability | Matbex | Evidence | Wafeq | Evidence |
|---|---|---|---|---|
| Accountant role | Has | `app_role` includes `accountant`. Lazy `AccountantDashboard.tsx` with real scoped data; `accountant-pending-alerts` email; inventory create and expense corrections without delete rights | Has | accountants page |
| Accounting-firm practice (many clients, one login, tabs) | **Missing** | `profiles.tenant_id` gives one tenant per user; there is no client switcher | Has | "Concurrent multi-client management", assign accountants to clients, partner tiers, free Premium for firms |
| Approvals | Has | Journal entries and expenses; sent-item voids; split-payment approvals in POS | Has | — |
| Audit trail | **Has (stronger)** | `audit_logs`, `tenant_activity_logs`, `superadmin_audit_events`, `role_impersonation_logs`, plus per-domain audits (`expense_amendment_audit`, `supplier_ap_account_audit`, `zatca_audit_trail`, `settlement_audit_logs` …), `AuditLogs.tsx` | Has | "complete history log" |
| MFA | Has | TOTP in `server/src/auth`; owner MFA gate `src/components/ProtectedRoute.tsx:191`; superadmin MFA | ? | not stated |
| Public tenant API | **Missing** | `/api/v1` is first-party (JWT for app users). `docs/terminal-api.md` covers POS terminals only. No API keys or OAuth apps for third parties | Has | REST, `Api-Key` + OAuth 2.0 scopes, ~265 endpoints, 60 req/min/org, idempotency, pagination, MCP server |
| Outbound webhooks for tenants | Partial | `webhook_configs` has **no `tenant_id`** (policy "Superadmins can manage webhook configs"), so it is platform-level. Internal events go through `platform.emit_event()` → Socket.IO | ? | not found in docs |
| Inbound integrations | Has (F&B) | Deliverect, aggregators, Moyasar, Checkout.com, Stripe (billing), Twilio/WhatsApp. Accounting export to QuickBooks/Zoho (Xero/SMACC in enum) | Has | Foodics, Stripe, Wio, SiFi, Enfaq, Supy, Baguno (directory p.1) |
| Data export | Has | `tenant-data-export` (PDPL portability, CSV zip incl. ledger and VAT), `data_exports`, `export_requests`, `zatca-audit-export` | ? | — |
| Data import / migration | Has | `Migration.tsx`, `migration-commit`, `import_row_fingerprints` (dedupe), competitor pages `src/pages/ar/ArVsQoyod.tsx` | ? | — |
| Mobile | Has (ops) | POS mobile `RecordSaleMobile.tsx`, Android manager app (`docs/android-manager-app.md`), waiter, KDS | ? | not stated |
| Multi-tenancy model | Has | RLS everywhere plus SECURITY DEFINER caller checks (`docs/self-hosting/FUNCTION_ACCESS_REVIEW.md`, `20261122102225_definer_functions_caller_checks.sql`); `/api/v1` modules call `requireRestaurantRole` | n/a | — |
| Hosting in KSA | **Not yet** | Staging is in Germany (`docs/self-hosting/STAGING.md`: "production placement should follow … Saudi data-residency") | Has | "Servers in Saudi Arabia" |
| Certifications | Missing | — | Has | SOC 2 Type II, ISO 27001, ISO 22301 (trust page, no certificate numbers) |
| Pricing | n/a | — | — | Starter SAR 99, Plus 119, Premium 199/mo (struck-through 119/149/249), Enterprise by quote; yearly = 10 months (pricing) |

---

## 3. Where Matbex is stronger

1. **Restaurant operations write the ledger.** The operation itself posts revenue, COGS, waste and payroll; nobody imports them. The pieces:
   - per-line provisional COGS from recipes (`trg_sales_items_after_insert_cogs`), trued up by stocktake (`cogs_trueup_*`);
   - waste posted automatically;
   - day-end night summaries posted to the ledger (`post_night_summary_to_ledger`, `post_daily_sales_to_ledger`), with day-end adjustments and reversals;
   - drawer and shift variances.

   Wafeq's Foodics integration gives a generic ledger *summaries*. Matbex has recipe-level food cost, prime cost and daily profit natively (`DailyProfit.tsx`, `PrimeCostCard`).
2. **Tender clearing accounts.** Card and mada settlements clear through a card-clearing account (`20261114133244_card_clearing_account_for_every_chart.sql`, `post_card_settlement_deposit`). Aggregator payouts clear the same way (`post_aggregator_settlement_reconciled`), and so do split tenders. This is the restaurant half of bank reconciliation that a general GL usually leaves to manual matching.
3. **Self-checking books.** Detectors and reconciliations run against the ledger:
   - invoice↔ledger divergence (`nightly-invoice-ledger-scan`);
   - VAT posting integrity incidents;
   - expense-ledger reconcile;
   - ZATCA↔P&L reconciliation;
   - installment VAT mismatch;
   - posting-rule audit (`PostingRuleAudit.tsx`) and the sale posting monitor.

   Wafeq's public material doesn't claim anything equivalent.
4. **ZATCA defensibility.** The POS records itself:
   - a per-device hash-chain integrity check;
   - an audit sequence;
   - an offline-safe clearance queue and worker;
   - device monitoring;
   - per-sale chain and document lookups via `/api/v1/zatca/*`.

   POS sales are priced server-side (`POST /api/v1/pos/sales`) and are voided, never deleted. In an audit, that is stronger evidence than importing POS totals into a GL.
5. **Domain finance products for KSA restaurants.** Beyond what Wafeq shows:
   - BNPL and instalment plans with VAT correction;
   - employee fines converted to instalments;
   - staff advances with payroll deduction;
   - owner capital and partner funding of projects or acquisitions;
   - municipality fines posted as expenses.
6. **Fine-grained authorization in the database.** RLS on every table, SECURITY DEFINER caller checks, and the accountant role scoped at both the navigation and DB levels. Wafeq's roles are unverified.

## 4. Gaps (candid)

### 4.1 Ledger integrity (platform debt, highest risk)

- **No journal header and no balance invariant.** `account_transactions` is a line table grouped by `(reference_type, reference_id)` or `batch_id`. Nothing at commit time asserts Σdebit = Σcredit per posting, except for expenses. 63 SQL functions insert ledger lines, and the browser can insert them too (`useJournalEntries.ts`), so a bug in any one silently unbalances the trial balance until a detector notices.
- **Measured on staging (production copy):** every posting balances once voided lines are excluded, and the TB is 0.00. But `chart_of_accounts.balance`, shown on the COA screen, drifts from the ledger by SAR 735,876 across 25 accounts, because its trigger fires on INSERT only. Details and the fix plan are in `docs/plans/ledger-integrity.md`.
- **No entry number** or sequential, gap-free journal numbering of the kind auditors expect.
- **Append-only for deletes, not for updates.** Hard deletes are always refused (`prevent_locked_period_modifications`). Browsers can't UPDATE lines either, because no RLS policy allows it. Definer functions can still UPDATE them, and superadmins bypass `enforce_fiscal_period_lock`. Voiding is done by flag (`is_voided`) on some paths and by reversal lines on others.
- **Day-end revenue posting is started by the browser.** `NightShiftSummaryForm` calls the posting RPC. It is guarded, but it means revenue lands in the ledger only when someone submits day-end (`DayEndStatusMatrix`, `days_without_eod` in the VAT figures). Move it to the worker (`tasks` queue), with an automatic fallback posting.

### 4.2 Accountant-facing gaps

- **Bank:** no bank-account entity, no statement import, no feeds, no matching rules, and no reconciliation report or lock.
- **Practice mode:** one login can't serve many clients, and there is no client list, firm-level billing, or consolidation.
- **AR:** no AR aging, statement of account, reminders, quotes, free-form invoices, pay links on invoices, or debit notes.
- **Bulk tools:** no bulk reclassification or spreadsheet-style editing. No recurring journals, prepaid amortisation, or revenue deferral (gift cards and loyalty liabilities could need this).
- **Multi-currency:** none. This matters little for a KSA-only restaurant, but blocks supplier bills in USD or AED and GCC expansion.
- **Payroll compliance:** no GOSI contributions or accrual, no WPS/Mudad file, and no EOSB provision. EOSB is a material liability for restaurants with many staff, and it is currently absent from the balance sheet.
- **Zakat:** no zakat base computation.

### 4.3 Platform gaps

- No public API for tenants: no API keys, OAuth apps, scopes, rate limits, idempotency documented for third parties, or an OpenAPI spec.
- No tenant webhooks. The outbox events exist (`platform.emit_event`) but only feed Socket.IO.
- Production hosting is not yet in KSA, and there are no SOC 2 or ISO 27001 reports. This counts in sales to chains and in PDPL/NCA conversations.
- CI is partial, per `ARCHITECTURE.md`. The migration check and image publishing are still to do.

## 5. Prioritized recommendations

Effort: S ≈ under 1 week, M ≈ 1–3 weeks, L ≈ 1–2 months, XL ≈ a quarter, for one engineer who knows the codebase.

| # | Gap to close | Why now | Effort | Notes / approach |
|---|---|---|---|---|
| 1 | **Journal header + balance invariant + append-only ledger** | Every other feature writes here; an unbalanced TB destroys accountant trust faster than any missing feature | M–L | Add `journal_entries` (id, tenant, branch, number via per-tenant sequence, date, source type/id, status, reversal_of). Backfill a header per `(reference_type, reference_id, batch_id)` and add `entry_id` to `account_transactions`. Use a `CONSTRAINT TRIGGER … DEFERRABLE INITIALLY DEFERRED` that checks Σdr = Σcr per entry. Use a BEFORE UPDATE/DELETE trigger that rejects changes except void-flag transitions, and corrections become reversal entries. Run detectors first to list the entries that are unbalanced today, and fix them with adjusting entries, never by editing |
| 2 | **Bank reconciliation v1** | The monthly job every accountant does; the most visible Wafeq advantage | L | Add `bank_accounts` (COA link, IBAN, currency). Import statements from CSV/XLSX (reuse `StatementCsvImportDialog` + `import_row_fingerprints`); add MT940/camt.053 later. Add `bank_statement_lines` with match status, rule-based auto-match against card deposits, supplier payments, expenses and transfers (AI suggestions via `_runtime/ai.ts`), a reconciliation report, and a reconciled-to date that feeds period lock. Put the matching job in the worker. Open Banking (Lean/Tarabut) is a later M once v1 works |
| 3 | **AR aging, statement of account, reminders** | Credit customers (corporate catering, hotels) already exist in `/api/v1/credit/*` | S–M | Add aging buckets over settlement invoices and on-account sales in a credit-module route, a PDF statement (reuse `generate-invoice-pdf`), and a scheduled reminder in `server/src/jobs/schedules.ts` |
| 4 | **Move day-end revenue posting server-side** | Removes the browser from the revenue path and makes books current without human action | M | Add a worker job per branch-day, triggered by shift close or a cutoff. Keep the night summary as review and adjustment; it never initiates posting |
| 5 | **Accountant practice mode** | Accountants pick the software; Wafeq gives firms free Premium to win them | L | Allow many tenants per user for the `accountant` role (`profiles.tenant_id` becomes the active tenant, with a membership list), a client switcher, a firm dashboard that aggregates `AccountantDashboard` pending work, and firm invites. RLS already keys on `user_belongs_to_tenant`; check every `profiles.tenant_id` read |
| 6 | **Wafeq / Qoyod export connector** | Turns the competitor into a channel: owners keep Matbex for operations while their accountant stays in Wafeq | M each | Wafeq: REST + `Api-Key`, Manual Journals / Invoices / Bills endpoints, 60 req/min/org. Add a provider to `accounting_integrations`, post daily summarized journals with per-entry idempotency keys, and run it on the BullMQ `tasks` queue. Depends on #1 (entry IDs) |
| 7 | **EOSB provision + GOSI accrual + WPS file** | EOSB is a real, unbooked liability; GOSI is a monthly cash cost | M (EOSB + GOSI), M (WPS/Mudad) | Monthly accrual job from `staff_rates`, posted through a new `post_*` function. Produce the WPS SIF/Mudad file from `payroll_records` |
| 8 | **KSA production hosting + security attestations** | Required for chains and enterprise deals; Wafeq advertises both | M (hosting), XL (SOC 2 / ISO 27001 programme) | Pick a KSA region (e.g. a local cloud provider) for production DB and storage. The SOC 2 Type I readiness tooling builds on what's already there (audit logs, MFA, backups, observability) |
| 9 | **Public API + tenant webhooks** | Enables chains' BI, payroll and ERP integrations | L | Publish `/api/v1` as OpenAPI with tenant API keys (hashed, scoped, per-tenant rate limits in Redis, idempotency like `pos_idempotency_keys`). Tenant webhooks = a tenant-scoped `webhook_subscriptions` fed from the existing outbox. Fix `webhook_configs` lacking `tenant_id` or keep it platform-only |
| 10 | **General invoicing: quotes, free-form B2B invoices, debit notes, pay links** | Catering and events revenue outside the POS | M | Reuse the ZATCA standard-invoice path (`0100000` clearance) and Moyasar pay with the restaurant's own key |
| 11 | **Recurring journals, prepaid amortisation, bulk reclassify** | Accountant productivity | M | Generalise `post_overhead_month_accrual` into recurring templates. Bulk reclassify = reversal + repost entries (never edits), depends on #1 |
| 12 | **Multi-currency (transactional) and cross-tenant consolidation** | Needed only for GCC expansion or multi-company groups | XL | Add currency, rate and functional amount per line, plus revaluation. Defer until a customer needs it |

Not recommended: matching Wafeq on manufacturing/BOM beyond recipes, a tax-legislation library, or a standalone ZATCA API product. These are far from the restaurant buyer.

## 6. Open questions / not verified

- Wafeq help centre, payroll statutory coverage (GOSI/WPS/Mudad/EOSB), named Saudi bank feeds, webhooks, mobile apps, per-plan feature matrix, and integration directory pages 2–3 were not readable or not found. Confirm in a trial account before using any of them in sales material.
- Wafeq's ZATCA pages say both "cleared" and "reported", so how it handles clearance vs. reporting by invoice type wasn't confirmed.
- Matbex: the extent to which current production ledgers are unbalanced per reference is unknown. Run a one-off `GROUP BY tenant_id, reference_type, reference_id HAVING sum(debit) <> sum(credit)` on staging/production before scoping #1.
