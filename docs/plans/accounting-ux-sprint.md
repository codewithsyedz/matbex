# Accounting UX sprint

Status: proposed (2026-11-26). Source: `docs/research/accounting-ux-review.md` (problems P1–P12). Runs alongside ledger integrity Phase B (`docs/plans/ledger-integrity.md`).

## Sprint goal

By the end of the sprint, an owner and their accountant can close a month from one page. That means:

- one profit number everywhere;
- every pending item and approval visible to the person who can act on it;
- locking that only the owner sees and only after checks;
- navigation grouped by job;
- the month-end screens in Arabic.

## Size and team

- **Length:** 2 weeks (10 working days).
- **Estimate:** about 44 engineer-days in total. Covering all twelve problems in one sprint needs **4–5 engineers or parallel sessions**, one per workstream below.
- **With fewer people:** one engineer would need about 9 weeks. If the team is smaller, keep workstreams A, B and C (the month-end job) and move D, E and F to the next sprint, in that order.
- **Parallel work:** each workstream owns its files (see "File ownership"), so the streams can run in parallel without editing the same files.

| Stream | Problems | Days | Depends on |
|---|---|---|---|
| A. One source of truth for numbers | P1 | 4.5 | — |
| B. Close the month | P2, P7, P12, lock part of P3 | 12 | A1 (shared P&L call) |
| C. Approvals and roles | P3 | 4 | B1 (endpoint) for counts |
| D. Navigation, terminology, states, mobile | P4, P6, P10, P11 | 9.5 | B2 and C2 routes exist (stub on day 1) |
| E. Arabic / RTL | P5 | 8 | Each stream's new strings arrive as keys |
| F. Bills & expenses entry point | P8 | 4 | Phase B lands `InventoryPurchaseForm` changes |
| G. Void UX | P9 | 2 | Phase B reverse route |

---

## Workstreams and tickets

Effort is in engineer-days. Each ticket lists its acceptance criteria.

### A. One source of truth for numbers (P1)

**A1. Finance Dashboard KPIs from the ledger (2 d).**
- `src/pages/FinanceDashboard.tsx` takes net sales, COGS, gross profit and net income from `get_profit_loss_by_branch`, through `useProfitLossReport`, instead of `useMonthlyPL`.
- Add one line under the KPIs: "Recorded at POS, not yet in the books: SAR X". It comes from the B1 endpoint and links to the Close page.
- *Done when:* for the same branch and range, the Finance Dashboard and `/reports/profit-loss` show the same four figures (vitest on the shared mapper, plus a manual check on staging).

**A2. Natural-sign balances (0.5 d).**
- The "Ledger balances by account type" tiles show revenue, liability and equity as positive credits.
- *Done when:* staging shows Revenue SAR 100, not −100.

**A3. Reports hub stops computing profit (1 d).**
- In `src/pages/Reports.tsx`, label the operational tiles "Recorded at POS (operational)".
- The P&L tab becomes a link card to `/reports/profit-loss`.
- Honour `?tab=` on load.
- *Done when:* the hub has no number labelled "profit" that differs from the ledger.

**A4. One trial balance (0.5 d).**
- Delete `src/components/accounting/TrialBalance.tsx` and the Accounting tab that uses it.
- `/accounting?tab=trial-balance` redirects to `/reports/trial-balance`.

**A5. Guard against drift (0.5 d).**
- Add a vitest that fails if any finance page imports `useMonthlyPL` for profit figures.
- `DailyProfit.tsx` keeps it, labelled "operational".

### B. Close the month (P2, P7, P12, lock part of P3)

**B1. Close checklist endpoint (3 d).**
- New domain module `server/src/modules/close/`: schema → routes → service → Drizzle repository. It calls `requireRestaurantRole` (owner, manager, accountant) and scopes every query by `restaurant_id`.
- Route: `GET /api/v1/close/checklist?month=YYYY-MM&branch=`. The month comes from the tenant's fiscal settings and timezone.
- It returns one row per check, with status (`ok`, `todo` or `blocked`), count, amount and fix URL:
  - days with sales but no EOD;
  - closed days not posted;
  - Daily Sales and other journals pending approval;
  - expenses pending approval or posting;
  - pending VAT splits;
  - card clearing outstanding;
  - stock count posted;
  - overhead accrual posted;
  - payroll unposted;
  - VAT return status for the period;
  - trial balance balanced;
  - already locked.
- It also returns a per-day pipeline for the month: POS total, EOD closed, posted, approved (P7).
- Browser access goes through `src/lib/api/close.ts`.
- *Done when:* there are route tests for each role and a check that tenants can't read each other's data, and on staging the endpoint returns the 3 pending journals and 3 no-EOD days seen in the review.

**B2. Close page `/accounting/close` (3 d).**
- The page has a month picker and the checklist, each row with a "Fix" link. Below it is the day-by-day "Sales → books" pipeline table.
- At the bottom is **Lock month**, for the owner only. If items are blocked, the owner must tick "Lock anyway" and give a reason, which is stored with the lock.
- *Done when:* an owner can go from the dashboard to a locked month without leaving the page except to fix items.

**B3. Locking only from the right place (1.5 d).**
- `MonthlyCloseManager.tsx` shows each month's checklist status (from B1). For non-owners, Lock is hidden and replaced by "Only the owner can lock. Ask the owner", which sends an owner notification.
- The Trial Balance "Close period" button (`src/pages/TrialBalance.tsx:161`) becomes "Close this month", linking to B2. It can no longer lock arbitrary ranges.
- *Done when:* as `qa-accountant`, no Lock control is clickable, and a partial-month lock can't be started from the UI.

**B4. Dashboards use the checklist (2 d).**
- `AccountantDashboard.tsx` replaces its own month-end queries with B1, so pending journals and VAT status appear.
- The owner and manager dashboards get the same Month-end box.
- Remove the hard-coded restaurant UUID and the `dev@matbex.com` text (P12). Pending-work emails become a per-tenant setting, run from `server/src/jobs/schedules.ts` on the `tasks` queue.
- "Last month" comes from fiscal settings and the restaurant timezone.
- This ticket also moves this file's `L()` strings into `ar.json`, so stream E doesn't touch the file.

**B5. System journals don't hide revenue (1.5 d).**
- *Decision needed (see below).* Default proposal: system-generated Daily Sales journals post without manual approval.
- This needs a migration on the day-end posting path, plus a DB test. Manual journals keep their approval.

**B6 (stretch). Day-end posting in the worker (Wafeq comparison #4) (1 d spike).**
- Write a design and a ticket breakdown only. Building it is M-sized backend work, and it is a separate sprint item.

### C. Approvals and roles (P3)

**C1. Approvals inbox (2.5 d).**
- `/accounting/approvals` lists pending journals and expenses together, with Approve and Reject for owners and managers.
- Reuse the logic in `PendingJournalEntriesCard` and `ExpenseApprovalQueue`.
- A count badge appears on the sidebar item and on the owner and manager dashboards. The count comes from B1 or a light count endpoint.
- *Done when:* an owner sees "Approvals 3" on staging without opening Accounting.

**C2. No dead ends for the accountant (1 d).**
- In the accountant's review list, approval items read "Waiting for owner/manager" and link to a read-only detail view.
- `ExpenseApprovalQueue` shows nothing to accountants, instead of a "no permission" card.

**C3. Names, not IDs (0.5 d).**
- `JournalEntryAuditTrail.tsx` resolves `approved_by` and `posted_by` to profile names.

### D. Navigation, terminology, states, mobile (P4, P6, P10, P11)

**D1. Sidebar regroup (2 d).**
- `AppSidebar.tsx` gets the groups Money out, Close the month, Reports, Books and Health checks, as proposed in review §P4.
- Add links for AP Aging, Day-End Status, Reversal Audit and AP Audit Trail.
- Rename "Bank Statement Match" to "Owner capital: statement match".
- Breadcrumbs are derived from the same nav config.
- Add `productNav` keys to `ar.json` (including the missing "Daily report").
- *Done when:* a script test shows every `/reports/*` and `/accounting/*` route is in the nav or explicitly listed as hidden.

**D2. Health checks page (2 d).**
- One page with a card per reconciliation or audit, each showing a count and red/green status and linking to its detail page.
- Shown to accountants, and to owners under "Advanced".
- The individual check pages leave the main sidebar.

**D3. Accounting page cleanup (1 d).**
- `src/pages/Accounting.tsx`: move the pending card and approval audit trail into an Approvals tab that links to C1.
- Remove the Trial Balance tab (A4).
- Tabs become a select on mobile.

**D4. Terminology (2 d).**
- For non-accountant roles, account names replace codes. Add a "Show account codes" preference.
- Rename pages per review §P6.
- Map `reference_type` values to readable labels.
- Add one-line help under Balance sheet, Trial balance and VAT "Accrual".
- Rewrite the Card Settlement Clearing setup guide without codes.

**D5. States, titles, mobile (1.5 d).**
- Every finance route gets a `RouteSeo` title.
- Loading KPI tiles are labelled.
- Empty states name their next action.
- On mobile, export actions collapse into a "⋯" menu.
- The POS device badge is hidden for roles that don't use the POS.

**D6. Buffer and design review (1 d).**

### E. Arabic / RTL (P5)

**E1. Lint first (1 d).**
- A CI check flags JSX text literals and physical direction classes (`ml-`, `mr-`, `pl-`, `pr-`, `text-left`, `text-right`) in finance pages.
- It starts as a warning list and becomes an error per file once that file is done.
- Fix the `reports.schedule` key error.

**E2. Translate in order of use (6 d).**

| File | Days |
|---|---|
| `VatReturn.tsx`: remove its private Arabic switch; add the ZATCA box names to `ar.json` | 1.5 |
| `ChartOfAccountsManager.tsx` | 1 |
| `MonthlyCloseManager.tsx` | 0.5 |
| `CardSettlementClearing.tsx` | 0.5 |
| `FixedAssets.tsx` | 1 |
| `Installments.tsx` | 1 |
| `DayEndStatusMatrix`, `BranchLedger`, `PendingVatSplit`, `DailyOverheadClosing` | 0.5 |

- The audit pages (`PostingRuleAudit`, `LedgerMapping`, `ReversalAudit`, `ApAuditTrail`, `CapitalStatementMatch`) are translated in the same pass if time allows. Otherwise they go behind Health checks (D2) and into the next sprint.
- `TransactionLedger.tsx` waits for Phase B and is translated by whoever finishes Phase B.

**E3. RTL check (1 d).**
- In Arabic at 375 px and on desktop, check each translated page on staging: no punctuation flips, columns mirrored, numbers left-to-right.

### F. Bills & expenses entry point (P8)

**F1. One "New" chooser (2 d).**
- The question "Paid now or on credit? Receipt or supplier invoice? Stock items?" routes to the expense dialog, the purchase invoice form or the inventory purchase form.
- Link to `InventoryPurchaseForm` and don't edit it until Phase B lands.

**F2. Bills & expenses inbox (2 d).**
- One list of expenses and supplier bills, with filters: draft, awaiting approval, posted, unpaid.
- It lives in the "Money out" group (D1).
- The Inventory tabs keep working and get a link to the inbox.

### G. Void UX (P9), delivered with Phase B

**G1. Acceptance criteria to Phase B (0.5 d).**
- Void or reverse whole entries, with a reason required.
- A locked period offers "Reverse in current period".
- Voided entries show a badge with who, when and why, and there is a visible "Show voided" toggle.

**G2. Entry points (1.5 d, after the Phase B route exists).**
- A "Void / reverse entry" action from P&L drill-down, account drill-down, the journal list, and the expense and bill detail views.

---

## File ownership (parallel work without conflicts)

| Files | Owner |
|---|---|
| `FinanceDashboard.tsx`, `Reports.tsx`, `components/accounting/TrialBalance.tsx`, `hooks/useProfitLoss.ts` | A |
| `server/src/modules/close/*`, `src/lib/api/close.ts`, new Close page, `MonthlyCloseManager.tsx` (logic), `pages/TrialBalance.tsx`, `AccountantDashboard.tsx`, owner and manager dashboards, day-end posting migration | B |
| New Approvals page, `PendingJournalEntriesCard.tsx`, `ExpenseApprovalQueue.tsx`, `JournalEntryAuditTrail.tsx`, `useExpenseApproval.ts` | C |
| `AppSidebar.tsx`, breadcrumbs, `Accounting.tsx`, Health checks page, `CardSettlementClearing.tsx` (copy), `RouteSeo` additions | D |
| `ar.json` / `en.json` additions for E2 files, the E2 page files, lint config | E (other streams add their own keys in their own PRs) |
| New chooser and inbox, `Expenses.tsx` (link only) | F |
| `TransactionLedger.tsx`, `JournalEntryForm.tsx`, `TypedJournalEntryForm.tsx`, `InventoryPurchaseForm.tsx`, `useJournalEntries.ts` | **Phase B only.** No stream edits them this sprint |

**Overlaps:**
- **`MonthlyCloseManager.tsx`** (B logic, E strings): B lands first, E translates afterwards, from day 6 on.
- **`CardSettlementClearing.tsx`** (D copy, E strings): D rewrites the copy as keys, so E has nothing left to do there.
- **`ar.json` / `en.json`:** every stream adds keys. Merge conflicts are trivial, but rebase often.

## Order within the sprint

| Days | Work |
|---|---|
| 1–2 | B1 endpoint (shape agreed on day 1 so C and D can stub it); A1–A2; C3; D1; E1; G1 |
| 3–6 | B2, B3; A3–A5; C1, C2; D2, D3; E2 (VAT, CoA, Card clearing); F1 |
| 7–9 | B4, B5; D4, D5; E2 (rest), E3; F2; G2 if Phase B is merged |
| 10 | Staging QA by role, fixes, release notes |

## Testing and release

- **Unit and route tests:** vitest for the mappers, route tests for `/api/v1/close/*` (each role, cross-tenant denied), and a DB test for B5.
- **Checks:** `npm run typecheck`, `lint`, `lint:edge-auth`, `test`, `test:db` and the bundle budget.
- **Staging QA** (QA Test Kitchen only, never real users or messages), run as `qa-owner`, `qa-accountant` and a manager. Walk the eight month-end jobs in the review's §3 table in English and Arabic, at desktop width and 375 px. Expected results:
  - the same profit appears on all screens;
  - October can be closed and locked from `/accounting/close`;
  - the accountant has no dead ends.
- **Release:** pushing `custom-backend` deploys staging and needs the owner's OK. Release notes must say that the Finance Dashboard profit now matches the ledger and will change for many tenants.

## Decisions needed before the sprint starts

1. **Team size.** 4–5 people or parallel sessions, or fewer people and A–C only (with D–F moved to the next sprint)?
2. **Do Daily Sales journals still need approval (B5)?** Proposed: system postings skip approval, and manual journals keep it.
3. **Locking with open items (B2).** Proposed: allowed for the owner with a reason. The alternative is a hard block.
4. **A staging manager user.** There is no `qa-manager@matbex.test`. Creating one needs the owner's OK; until then the manager role is tested from code only.

## Tracking and automation

The sprint is tracked in Linear: workspace `codewithsyed`, project `P-COD-1`, issues COD-7…COD-39. Ledger Phase B is COD-5 and Phase C is COD-6. Two scheduled tasks in the Claude desktop app run it. Both run only while the app is open; a missed run fires on the next launch.

| Task | When | What it does |
|---|---|---|
| `matbex-sprint-weekly-planner` | Monday 08:00 | Reads Claude plan usage and the dispatcher's usage log, and measures the cost per engineer-day. It then picks the issues that fit under the budget, moves them to Todo, re-dates the rest and posts a Linear project update. It writes no code |
| `matbex-sprint-daily-dispatch` | Weekdays 09:00 | Takes at most one planned issue whose blockers are all **Done**. It implements it in `../matbex-worktrees/<issue>` on the issue's branch, runs typecheck, lint and tests, and commits locally. It then moves the issue to In Review and comments in Linear. **It never pushes, deploys or touches staging** |

**Budget rule:** new work starts only while the weekly limit is under 80% and the 5-hour limit under 70%. No paid extra usage.

**Never automated:** Decision issues, COD-37 (RTL check on staging) and COD-39 (release QA).

**Human gate:** you review each In Review branch, merge it into `custom-backend` and mark the issue Done. That unblocks the issues that depend on it. Pushing still needs your OK.

**State files** (outside the repo), in `~/.claude/scheduled-tasks/`:
- `matbex-sprint-plan.json`
- `matbex-sprint-usage.jsonl`
- `matbex-sprint.lock`

**Expect a smaller sprint.** On the Pro plan, the automation covers a fraction of the 44 engineer-days per week. The planner moves the rest to later weeks and reports the gap.

## Not in this sprint

- **Bank reconciliation** (Wafeq comparison #2, L). It is the largest functional gap, but it is a feature, not a UX fix.
- **Day-end posting in the worker (B6).** Only the design is done this sprint.
- **Ledger integrity Phase C** (journal header and entry numbers).
