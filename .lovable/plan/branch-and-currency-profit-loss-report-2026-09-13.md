# Branch and currency Profit & Loss report

## Goal
Build a dedicated ledger-backed Profit & Loss page showing revenue, cost of goods sold, operating expenses, and net profit for each branch and currency, with the same clinical layout and Arabic RTL support as Balance Sheet and Cash Flow.

## Implementation
1. Add a secure reporting function that reads posted, non-voided ledger entries for the selected tenant, date range, and optional authorized branch, then returns revenue, COGS, and expense accounts grouped by branch and currency.
2. Add a focused P&L data hook that groups ledger rows by branch/currency and calculates gross profit, operating expenses, net profit, and margins without mixing currencies.
3. Build `/reports/profit-loss` using the established report layout: branch/date/currency controls, consolidated KPI totals, a consolidated statement, per-branch statements, compact responsive tables, loading/error/empty states, and CSV export.
4. Add the page to protected routing and Finance navigation while keeping the existing Reports tabs unchanged.
5. Add complete English and Arabic labels, localized dates, RTL-safe alignment, logical spacing, and translated report states.
6. Verify function permissions and branch isolation, type safety, locale validity, build output, and desktop/mobile rendering in English and Arabic.

## Technical notes
- Use the immutable ledger as the source of truth; include only non-voided entries in the requested period.
- Revenue uses credit-minus-debit; COGS and operating expenses use debit-minus-credit.
- Gross profit = revenue − COGS. Net profit = gross profit − operating expenses.
- Group source rows by branch and each branch’s ledger currency. Convert only consolidated display totals with the existing currency service; preserve source currency in branch tables and CSV exports.
- Enforce tenant membership and branch access inside the security-definer function, matching the Balance Sheet and Cash Flow security model.
- Keep accounting feature gating, semantic theme tokens, dense clinical tables, and the existing mobile overflow pattern.
