# Accounting module UX review

Date: 2026-11-26. Branch read: `custom-backend` at `d4bef0d` (ledger integrity Phase A).

Scope: the screens under `/accounting/*`, `/reports/*` and `/expenses/*`, the Finance and Accountant dashboards, and the sidebar (`src/components/layout/AppSidebar.tsx`). This is research only: no app code was changed.

## How this was checked

- **Code:** routes in `src/components/AnimatedRoutes.tsx`, pages in `src/pages/`, components in `src/components/accounting/`, and the hooks behind them.
- **Staging** (https://staging.matbex.com, tenant "QA Test Kitchen"): signed in as `qa-accountant@matbex.test` and read the Accountant dashboard, Accounting → Period Close, Trial Balance, VAT Return, Card Settlement Clearing, Finance Dashboard, Profit & Loss and the Reports hub. I checked Arabic and 375 px mobile width on three of those pages. I created, posted and locked nothing.
- **Not covered:** there is no QA manager user, so the manager role was reviewed from code only (`isManager` checks). The owner was also reviewed from code; staging was not clicked through as `qa-owner`.
- **Being changed elsewhere:** ledger integrity Phase B (`docs/plans/ledger-integrity.md`) is rewriting manual journals and voids in `useJournalEntries.ts`, `JournalEntryForm.tsx`, `TypedJournalEntryForm.tsx`, `InventoryPurchaseForm.tsx` and `TransactionLedger.tsx`. Those journeys are described below as they are today. Their UX is changing, so the fixes here are input for Phase B, not separate work.

---

## 1. Summary

Matbex's books are rich: restaurant activity posts itself, and there are many self-checks. But the accounting UI shows *how the system is built*, not *what the owner or accountant needs to do this month*. The five biggest problems:

1. **Screens disagree on profit for the same month.** On staging for November 1–26:

   | Screen | Revenue / net sales | Net profit |
   |---|---|---|
   | Finance Dashboard | SAR 530.60 | SAR −3,209.50 |
   | Profit & Loss | SAR 100.00 | SAR −300.00 |
   | Reports hub (last 7 days) | SAR 415.60 | SAR 415.60 |

   The three screens use three different calculations.
2. **There is no month-end close flow.** The work that blocks a close is spread over about eight screens. The accountant dashboard misses some of it, and locking a month runs no pre-close checks.
3. **Roles hit dead ends.** The accountant is shown "Lock" buttons that the database refuses, and "Awaiting approval" items that open a queue telling them they have no permission.
4. **The navigation has about 45 finance pages across six sidebar groups.** "Checks" are scattered across those groups, four report routes have no sidebar link at all, supplier bills sit inside Inventory, and "Bank Statement Match" is really owner-capital matching.
5. **Arabic is missing on most accounting pages.** 15 accounting pages and components have no translation calls. In Arabic mode they show English text in RTL layout, with broken punctuation.

---

## 2. Ranked problems

Ranked by impact on a restaurant owner or their accountant. Effort assumes one engineer who knows the codebase: **S** = under 1 week, **M** = 1–3 weeks, **L** = 1–2 months.

### P1. The same month shows three different profits (M)

**Where:**

| Screen | Data source | Basis |
|---|---|---|
| `src/pages/ProfitLoss.tsx` | `useProfitLossReport` → `get_profit_loss_by_branch` | Ledger |
| `src/pages/FinanceDashboard.tsx` | `useMonthlyPL` (`src/hooks/useProfitLoss.ts`) reading `sales_transactions`, `expenses`, `daily_cogs_submissions`, `overhead_allocation`, `payroll_records` | Operational tables |
| `src/pages/Reports.tsx` (Overview / Financial / P&L tabs) | Its own queries on `sales_transactions`, `expenses`, `purchases`, `payroll_records` | Operational tables |

There are also two trial balances:

- **Accounting → Trial Balance tab:** `src/components/accounting/TrialBalance.tsx`. It reads `account_transactions` in the browser, tenant-wide, with no branch filter.
- **`/reports/trial-balance`:** `src/pages/TrialBalance.tsx` via `useTrialBalance`.

**Staging evidence (November 1–26):**
- The Finance Dashboard shows net sales SAR 530.60, COGS 175.10 and net income SAR −3,209.50.
- The ledger P&L shows revenue SAR 100.00, opex 400.00 and net SAR −300.00. It is labelled "From ledger".
- The Reports hub shows net profit SAR 415.60 for the last 7 days and SAR 0 expenses.
- On the same Finance Dashboard, the "Ledger balances by account type" tiles use raw debit-minus-credit signs: Revenue SAR −100, Liabilities SAR −3,465, Assets SAR −285. An owner reads that as losing money on revenue.

**Why it matters:** the owner can't tell which number is "the profit". The accountant ends up defending the ledger against a dashboard that the owner sees first. The gap is real, not a bug in one screen: sales that have no day-end, or whose day-end journal is still pending, are in the operational figures but not yet in the ledger (see P7).

**Fix:**
- Make the ledger the single source for anything called P&L, profit or net income. Point the Finance Dashboard KPIs at `get_profit_loss_by_branch`.
- Where an operational figure is useful (today's sales before day-end), label it as such ("Sales recorded at POS, not yet in the books: SAR X") and link to the cause.
- Remove the P&L tab from the Reports hub, or make it link to `/reports/profit-loss`.
- Drop the client-side Accounting → Trial Balance tab and link to `/reports/trial-balance`.
- Show account-type balances with their natural sign: revenue, liabilities and equity as positive credits.

### P2. No single month-end close workflow; pending work is scattered (M–L)

**What an accountant has to visit to close October:**

| Close step | Where it lives |
|---|---|
| Days with sales but no day-end | Accountant dashboard → `/sales` (Day-End), and also `/reports/day-end-status`, which has no sidebar link |
| Closed days not posted | Accountant dashboard → `/daily-profit` |
| Daily Sales journals pending approval | Accounting → any tab → "Journal Entries · pending" card (`PendingJournalEntriesCard`). **Not** on the accountant dashboard. On staging, three entries were pending: Daily Sales for 11-12 and 11-13, and an expense |
| Expenses awaiting approval or posting | `/expenses` approval queue, and the accountant dashboard "Corrections & reviews" table |
| Pending VAT splits | `/expenses/pending-vat-split` |
| Card payouts not recorded | `/accounting/card-settlement-clearing` |
| Stock count / COGS true-up | `/cogs-trueup` |
| Rent and overhead accrual | `/accounting/daily-overhead` |
| Payroll not posted | `/staff/payroll-journal` |
| VAT return | `/reports/vat-return`. Its status (draft, ready, submitted, paid) is not linked to the lock |
| Lock | Accounting → Period Close tab (`MonthlyCloseManager.tsx`), **or** the "Close period" button on `/reports/trial-balance` |

Other problems with the close:
- `MonthlyCloseManager` lists 12 months, each with a bare "Lock" button. The confirm dialog checks nothing. You can lock a month with unposted days, pending journals and an unfiled VAT return.
- The Trial Balance "Close period" button (`src/pages/TrialBalance.tsx:161`) locks whatever from–to range is selected. With the default "This month" on staging, that is **Nov 1 – Nov 26**, a partial month.
- An owner or manager has no equivalent of the accountant dashboard's "Month-end" box. `AccountantDashboard.tsx` renders only for accountant-only sessions.

**Fix:**
- Add a **Close** page, `/accounting/close?month=YYYY-MM`, for owner, manager and accountant. It shows one checklist, with each row's status, amount and a "Fix" link, built from the queries already in `AccountantDashboard.tsx`:
  - unposted or no-EOD days;
  - pending journals;
  - expense approvals and VAT splits;
  - card clearing balance;
  - stock count;
  - overhead accrual;
  - payroll;
  - VAT return status;
  - trial balance balanced.
- End the checklist with **Lock month**, enabled for owners only, with blocked items shown.
- Remove the Trial Balance "Close period" button, or make it link to the Close page for the selected month.
- Show "pending approval" journals in the accountant dashboard's Month-end box. Show the same box on the owner and manager dashboard.

Wafeq comparison: Wafeq advertises approval routing ("choose who submits, approves and posts") and a bank reconciliation report, but not a restaurant-specific close checklist (`docs/research/matbex-vs-wafeq.md` §2.1, §2.4). Matbex already computes the inputs for a better close than Wafeq's. The gap is that it doesn't present them as one job.

### P3. Role dead ends for accountants (S)

**Where:**
- **Locking:** `MonthlyCloseManager.tsx` and the Trial Balance "Close period" button render for everyone who can open them. `lock_fiscal_period` raises "Only owners can lock fiscal periods" (`db/migrations/20261119114011_lock_fiscal_period_owner_check.sql`). On staging the accountant sees 12 "Lock" buttons and the "Close period" button. Clicking one ends in an error toast.
- **Expense approvals:** the accountant dashboard tags expenses "Awaiting approval" and links to `/expenses?expense=…`. The approval queue at the top of that page says "You don't have permission to approve expenses." (`src/components/expenses/ExpenseApprovalQueue.tsx:91`; `canApprove` is `isManager || isOwner` in `src/hooks/useExpenseApproval.ts:834`). The accountant can't act and isn't told who can.
- **Journal entries:** the pending card says "Entries you submit appear here until an owner or manager approves them". That is correct, but an owner who never opens Accounting won't see them. Approvals reach the owner only as notifications (`NotificationCenter.tsx`).
- **Audit trail names:** the Journal Approval Audit Trail shows the actor as a UUID prefix (`63eb7ad3…`), not a name.

**Fix:**
- Hide or disable Lock for non-owners, with "Only the owner can lock. [Ask owner to lock October]" (a notification to owners).
- In the accountant's review list, label approval items "Waiting for owner/manager approval". Don't link the accountant to a queue they can't use.
- Add an **Approvals** count badge in the sidebar and on the owner and manager dashboard, covering journals and expenses.
- Resolve `approved_by` and `posted_by` to profile names in `JournalEntryAuditTrail.tsx`.

### P4. Navigation: about 45 finance pages, checks scattered, some unreachable (M)

**Where (`AppSidebar.tsx`):** finance pages are spread over six groups:

| Group | Finance-related contents |
|---|---|
| Home | Reports, Finance Dashboard |
| Sales & Customers | 6 sales reports, plus 3 "Checks" |
| Menu & Inventory | COGS, COGS true-up, Account Mappings |
| Purchases & Expenses | Expenses, VAT split, Supplier Ledger, 3 overhead pages, 4 "Checks" |
| Accounting | 5 pages, plus Statements (6), Bank & cards (2), Installments (3), Setup & audit (3) |
| VAT & Compliance | 6 pages |

Specific problems:
- **No sidebar link at all:** `/reports/ap-aging`, `/reports/ap-audit-trail`, `/reports/reversal-audit` and `/reports/day-end-status`. They are reachable only from the Finance Dashboard's "Jump to Reports" card, which also lists Trial Balance twice. AP aging is a core accountant report.
- **Supplier bills (purchase invoices) are not under "Purchases & Expenses".** They are Inventory → tab 7 of 14 ("Invoices"), with supplier payments in tab 11 (`src/pages/Inventory.tsx:594-607`).
- **"Bank Statement Match"** (Accounting → Bank & cards) opens `/accounting/capital-statement-match`, which matches *owner capital* movements. An accountant looking for bank reconciliation will think it is that. There is no bank reconciliation; see the Wafeq comparison, gap #2.
- **"Checks" sections** (Sale Posting Monitor, Daily/Price/Supplier-AP/Expense-ledger/Invoice-ledger reconciliations, AP head audit, posting rule audit, overhead audit, VAT audit) appear in four groups. Most are diagnostics for engineers or the accountant, and are shown to non-accountant owners next to everyday pages.
- **Trial Balance appears twice:** as an Accounting tab and under Statements. The two are different implementations (P1).
- **Breadcrumbs say the wrong section.** They read "Reports › Trial Balance" while the sidebar puts it under Accounting › Statements. Card Settlement Clearing shows "Accounting".
- **The Accounting page** (`src/pages/Accounting.tsx`) has 7 tabs: Chart of Accounts, Ledger, Period Close, Mapping Audit, Drill-Down, Trial Balance and Posting Center. The pending-journals card and the approval audit trail render *below every tab* (they sit outside `TabsContent`), so the Chart of Accounts tab ends with an audit log.

**Fix:** regroup around jobs. A proposal:

| Group | Contents |
|---|---|
| **Money out** | Expenses, Supplier bills (moved from Inventory), Supplier payments, Supplier ledger, AP aging |
| **Close the month** | Close checklist (P2), Day-end status, Card settlement clearing, Overheads, VAT return, Period locks |
| **Reports** | P&L, Balance sheet, Cash flow, Trial balance, General ledger / drill-down, VAT audit, Depreciation |
| **Books** | Chart of accounts, Journal entries, Fixed assets, Owner capital, Projects, Installments |
| **Health checks** (one page, accountant or "advanced" only) | Cards for every reconciliation and audit, each showing a count and a red/green status, linking to the detail page |

Also:
- Rename "Bank Statement Match" to "Owner capital: statement match".
- Move the pending card and audit trail into their own "Approvals" tab.
- Give every route a sidebar entry or delete it.

### P5. Arabic / RTL coverage is missing on most accounting screens (L)

**Where:** these files have zero `t()` calls:

| Pages (`src/pages/`) | Components (`src/components/accounting/`) |
|---|---|
| `VatReturn.tsx` (1,063 lines) | `ChartOfAccountsManager.tsx` |
| `FixedAssets.tsx` (1,563) | `TransactionLedger.tsx` |
| `Installments.tsx` (1,178) | `MonthlyCloseManager.tsx` |
| `CardSettlementClearing.tsx` | `TrialBalance.tsx` |
| `DayEndStatusMatrix.tsx` | |
| `BranchLedger.tsx` | |
| `CapitalStatementMatch.tsx` | |
| `DailyOverheadClosing.tsx` | |
| `PostingRuleAudit.tsx` | |
| `LedgerMapping.tsx` | |
| `ReversalAudit.tsx` | |
| `ApAuditTrail.tsx` | |
| `PendingVatSplit.tsx` | |

The localized pages are ProfitLoss, BalanceSheet, CashFlow, TrialBalance (page), ApAging, SupplierLedger, VatAudit and FinancialStatements. Other gaps:
- `AccountantDashboard.tsx` hard-codes its Arabic in 56 inline `L("en","ar")` pairs instead of `src/i18n/locales/ar.json`.
- `VatReturn.tsx` has its *own* "العربية" switch, separate from the app language.
- Physical CSS classes (`ml-/mr-/pl-/pr-`, `text-right/left`) remain, for example 53 and 32 in `VatReturn.tsx`, so columns and icons don't mirror.
- The sidebar labels *are* translated: only "Daily report" is missing from `productNav` in `ar.json`.

**Staging evidence:** in Arabic, `/accounting/card-settlement-clearing` keeps an English title, buttons and setup guide. Sentences render with the full stop at the wrong end (".account when the acquirer payout is recorded here"). "Online" in the header is untranslated. The Reports hub shows a raw i18n error string in English mode: "key 'reports.schedule (en)' returned an object instead of string."

**Why it matters:** many restaurant owners in KSA work in Arabic, and the VAT return is a ZATCA document.

**Fix:**
- Localize in order of use: VAT Return, Chart of Accounts, Transaction Ledger, Period Close, Card Settlement Clearing, Fixed Assets, Installments. Move the `L()` pairs into `ar.json`. Replace physical classes with logical ones (`ms-/me-/ps-/pe-`, `text-start/end`). Remove the VAT page's private Arabic toggle and add the ZATCA box names to `ar.json`.
- Add a lint rule or CI check that flags JSX text literals in `src/pages/**` finance routes.
- Fix the `reports.schedule` key.

### P6. Terminology and signs written for the system, not the owner (S–M)

**Where:**
- Owner-facing copy uses raw account codes. The Card Settlement Clearing setup guide says "Create 1015 Card Settlements Receivable" and "Point 1010 at your real business bank account". The accountant dashboard says "card money still in transit (1015)".
- Internal names are exposed as tabs and menu items: "Posting Center", "Mapping Audit", "Posting Rule Audit", "CoA Migration", "Ledger Mapping", "Supplier AP Head Audit", "Reversal & Reopening Audit".
- Balances use debit-minus-credit signs (P1).
- The VAT return says "Basis: Accrual" with no explanation.
- `account_transactions.reference_type` values such as `sale`, `expense`, `invoice_payment` and `purchase_invoice` appear verbatim in the TYPE column of the journal cards.

**Fix:**
- For non-accountant roles, show account *names* and hide codes (add a "Show account codes" preference for accountants).
- Rename the pages (current name → proposed):

  | Current | Proposed |
  |---|---|
  | Posting Center | Unposted transactions |
  | Mapping Audit | Accounts not set up |
  | Card Settlement Clearing | Card payouts |
  | Supplier AP Head Audit | Supplier balance checks |
  | Bank Statement Match | Owner capital match |

- Add one-line "what this means" help under each statement title: Balance sheet, Trial balance, Accrual.
- Map `reference_type` to readable labels.

### P7. Day-end to ledger: the owner can't see why revenue isn't in the books (M)

**Where:**
- The accountant dashboard's "Sales missing from the ledger" box lists "N days with sales but no End of Day" (links to `/sales`) and "closed days not posted" (links to `/daily-profit`).
- Separately, day-end posting creates "Daily Sales – YYYY-MM-DD" journals that wait for approval in Accounting. Staging has two from 11-12 and 11-13.
- The day-end state matrix (`/reports/day-end-status`) has no sidebar link.
- So the same revenue can be stuck at three stages (no EOD, EOD not posted, posted but pending approval), each on a different screen. That is also the main reason P1's numbers differ.

**Fix:**
- In the short term, show a single "Sales → books" pipeline per day on the Close page and the dashboards. Its columns would be POS total, Day-end closed, Posted and Approved, with a fix action in each column.
- In the long term, carry out the Wafeq comparison's recommendation #4: the worker posts day-end automatically, and the night summary becomes review-only.
- Consider auto-approving system-generated Daily Sales journals. They are not manual entries, and requiring approval for them hides revenue.

### P8. Expenses and supplier bills are two separate flows (M)

**Where:**
- **Expenses:** `src/pages/Expenses.tsx` is 4,104 lines. It starts with the approval queue, a mapping-gaps panel and a VAT split panel, then the list.
- **Supplier bills:** recorded in Inventory → Invoices (`InvoiceManager.tsx`), paid in Inventory → Payments (`SupplierPayments.tsx`), and posted through purchase-invoice journals.
- **Journals:** Accounting also offers a "Record Purchase" button (`InventoryPurchaseForm.tsx`, being changed in Phase B).

An owner has three ways to record "I bought supplies", each with different VAT, approval and ledger behaviour.

**Fix:**
- Give one **Bills & expenses** entry point with a single "New" button. It asks "Paid now or on credit? Supplier invoice or receipt? Stock items?" and routes to the right posting.
- List all of them in one inbox, with status filters: draft, awaiting approval, posted, unpaid.
- Keep the purchase-invoice logic. This is IA and forms work.

### P9. Voiding a mistake: line-level, hidden in a tab (M, in Phase B)

**Where:**
- Today the void action lives only in Accounting → Transaction Ledger (`TransactionLedger.tsx`), on individual lines.
- Voided rows are hidden by default.
- Settlement-batch rows and locked-period rows can't be voided, and the user isn't told what to do instead.
- Since Phase A, a void is flag-only. The dialog copy was updated in `d4bef0d`.

**Fix (input for Phase B):**
- Void a whole entry from wherever it is shown: P&L drill-down, account drill-down, the journal list, and the source document (expense, bill).
- Require a reason.
- When the period is locked, offer "Reverse in the current period" instead of a dead end.
- Show a "Voided" badge with reason, who and when, and keep a visible toggle to show voided entries.

### P10. Empty, loading and error states, and page titles (S)

**Seen on staging:**
- The Finance Dashboard KPI tiles (Net sales, COGS, Gross profit, Net income) show unlabelled blank skeletons for about 6–10 s on a tiny dataset.
- The Reports hub ignores `?tab=pl` and opens Overview, so deep links from elsewhere don't land where they should.
- Most report pages share the document title "Matbex | Restaurant OS for COGS, Payroll & Inventory". Only the dashboards set their own, so browser tabs and history can't be told apart.
- Period Close shows 12 identical "Lock" rows with no status (posted, balanced, VAT filed) to help pick which one to lock.
- The P&L page handles empty sections well ("No activity in this section.") and has a useful "P&L to equity reconciliation" and "ZATCA reconciliation". Bring the same pattern to the Finance Dashboard.

**Fix:**
- Give every finance route a `RouteSeo` title.
- Label loading tiles, or load KPIs from one RPC.
- Honour `tab` query params on the Reports hub.
- Give empty states a next action ("No card payouts recorded. Record one from your bank statement").

### P11. Mobile width (S)

**Seen on staging at 375 px:** VAT Return, Trial Balance and Card Settlement Clearing had no horizontal page scroll (scrollWidth equals width). But:
- On Trial Balance, four full-width buttons (range, Close period, Export CSV, Export PDF) push the data below the fold.
- The 7 Accounting tabs wrap onto several lines.
- A red "Device blocked" badge in the header shows for the accountant on a phone, which reads as an error in an accounting context.
- Tables rely on horizontal scroll inside cards, which is acceptable.

**Fix:**
- On mobile, put export actions in one "⋯" menu.
- Make the Accounting tabs a select.
- Hide the POS device badge for roles that don't use the POS.

### P12. Accountant dashboard has a tenant-specific hack in shipped UI (S)

**Where:** `src/pages/AccountantDashboard.tsx:41` and `:145` hard-code one restaurant UUID. For that tenant, the page shows "Email alerts: dev@matbex.com …" and calls `accountant-pending-alerts`. The month-end calculations also use the browser's date (`new Date()`) for "last month", not the tenant's fiscal month and timezone (`getFiscalMonthRange` is used for the range picker but not for `lastMonthEnd`).

**Fix:**
- Replace the hard-coded UUID with a per-tenant setting and the BullMQ schedule (per AGENTS.md, scheduled runs belong in `server/src/jobs/schedules.ts`).
- Compute "last month" from `useFiscalSettings` and the restaurant timezone.

---

## 3. Role walk-throughs

Click counts are from the sidebar, with the relevant group collapsed, to the action being saved. "—" means the role can't do it.

| Job | Owner (non-accountant) | Accountant | Manager |
|---|---|---|---|
| **Record an expense** | Expenses → New → form → Save: about 4 clicks plus fields. Auto-approved for owner | Dashboard "Record expense" → Save: about 2 clicks. Goes to approval | As owner, about 4 clicks |
| **Approve an expense** | Expenses → approval queue at top → Approve: 2–3 clicks. Nothing tells the owner the queue has items unless they open Expenses | — ("You don't have permission"). The dashboard tags it but links to a dead end (P3) | As owner |
| **Record and pay a supplier bill** | Menu & Inventory → Inventory → Invoices tab → New → form → Save, then Payments tab → Pay: about 8–10 clicks across 2 tabs (P8) | Same, if inventory access is allowed | Same |
| **Post a manual journal** | Accounting → "New journal entry" → form → Submit: about 4 clicks. *Changing in Phase B* | Same, if `can_post_journal_entries` allows it; goes to pending | Same; can approve |
| **Approve a journal** | Accounting → scroll below the tabs to the "Journal Entries · pending" card → Review → Approve: about 4 clicks plus scrolling. Notification bell is the only prompt | — (submit only) | Same as owner |
| **Void a mistake** | Accounting → Ledger tab → find the line (filters) → Void → reason → Confirm: 6+ clicks, line by line. *Changing in Phase B* | Same, subject to `canVoidTransaction` | Same |
| **Reconcile card payouts** | Accounting group → Bank & cards → Card Settlement Clearing → Record payout → fill amount, fee, date and bank → Post: about 6 clicks. Setup guide uses account codes (P6) | Dashboard Month-end link → Record payout → Post: about 4 clicks | Same as owner |
| **Close day-end** | Sales → Day-End → summary form → Submit, then possibly approve the "Daily Sales" journal in Accounting: about 6–8 clicks on 2 screens (P7) | Can see that days are missing; closes via Sales if allowed | Same as owner |
| **VAT return** | VAT & Compliance → VAT Return → pick quarter → 4-step wizard → Save → "Mark submitted" → enter date and SADAD number → "Mark paid": about 10 clicks. The page is English-only (P5) and not linked to the lock | Same | Same |
| **Lock a period** | Accounting → Period Close tab → Lock → Confirm: 4 clicks, no checks (P2). Or Trial Balance → Close period, which can lock a partial range | — (buttons shown, DB refuses: P3) | — (owner-only in DB; buttons shown) |
| **Read P&L / BS / TB** | Accounting → Statements → each: 2 clicks each. Finance Dashboard and Reports show *different* profit (P1) | Same, plus a P&L shortcut on the dashboard | Same |

**Pending-work visibility per role:**
- **Accountant:** has the only month-end summary (dashboard), but it misses pending journals and VAT return status.
- **Owner and manager:** get no summary. They learn about pending work only from notifications, or by visiting Expenses or scrolling the Accounting page.

---

## 4. Quick wins (each S, about a day or less)

1. Hide or disable **Lock** and **Close period** for non-owners, with "Only the owner can lock" text (`MonthlyCloseManager.tsx`, `src/pages/TrialBalance.tsx`). Restrict Trial Balance "Close period" to whole fiscal months.
2. Add sidebar links for **AP Aging**, **Day-End Status**, **Reversal Audit** and **AP Audit Trail**. Remove the duplicate Trial Balance link in the Finance Dashboard's "Jump to Reports".
3. Rename "Bank Statement Match" to "Owner capital: statement match".
4. Add a "Journals pending approval: N" line to the accountant dashboard Month-end box, linking to `/accounting?tab=…`.
5. Change the accountant's "Awaiting approval" rows to read "Waiting for owner/manager", with no dead-end link.
6. Show Finance Dashboard account-type balances with their natural sign.
7. Label the Reports-hub figures "Recorded at POS (operational)" and link "Profit & Loss (books)".
8. Give every finance route a `RouteSeo` title, and honour `?tab=` on `/reports`.
9. Fix the `reports.schedule` i18n key error, and add "Daily report" to `productNav` in `ar.json`.
10. Resolve user UUIDs to names in the Journal Approval Audit Trail.
11. Move the pending-journals card and audit trail into an "Approvals" tab on `/accounting`.
12. Remove the hard-coded restaurant UUID from `AccountantDashboard.tsx`.

---

## 5. Month-end flow compared with Wafeq

Based on Wafeq's public pages, as cited in `docs/research/matbex-vs-wafeq.md`. Wafeq's help centre was unreadable, so its in-product UX is not verified.

| Month-end step | Wafeq (as advertised) | Matbex today | Takeaway |
|---|---|---|---|
| Capture sales | Imported, e.g. a Foodics summary | Posted by the operation (POS → day-end → journal), but in three stages on three screens | Matbex's data is better; its visibility is worse (P7) |
| Bills and expenses | One bills/expenses area, AI inbox via email and WhatsApp | Expenses page plus Inventory invoices plus the Accounting "Record Purchase" | Unify the entry point (P8); invoice OCR exists (`scan-supplier-invoice`) but isn't front-and-centre |
| Approvals | "Choose who submits, approves and posts" | Exists for journals and expenses, but with no shared inbox or badge | Add an Approvals inbox and count (P3) |
| Bank reconciliation | Feeds, AI matching, reconciliation report | Card payouts only; "Bank Statement Match" is owner capital | Real gap (Wafeq comparison #2); fix the label now |
| VAT return | Generated automatically | Generated from the ledger, with integrity checks and a 4-step wizard; English-only | Matbex is stronger on content; localize it and link it to the lock |
| Lock | Not stated | Owner-only lock with an unlock-request workflow, but no checks before locking | A close checklist would put Matbex ahead |
| Reports | "Over 40" reports in one report centre | About 45 pages spread over six sidebar groups, with conflicting P&L numbers | Consolidate (P4) and use one source of truth (P1) |
| Accountant practice | Multi-client firm view | One tenant per login | See Wafeq comparison #5 |

**Bottom line:** Matbex already computes most of what a restaurant close needs, often more than Wafeq: day-end gaps, card clearing, stock count, overhead accrual, VAT integrity. Most of the UX gap is presentation: one close checklist, one profit number, one approvals inbox, and Arabic on the VAT and ledger screens. Bank reconciliation is the one large missing feature.
