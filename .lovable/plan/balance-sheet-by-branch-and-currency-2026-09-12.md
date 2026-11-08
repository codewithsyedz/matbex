# Balance Sheet by Branch and Currency

## Goal
Add a protected Balance Sheet report that reads posted, non-voided ledger entries through a selected date and presents Assets, Liabilities, and Equity for each branch and for the consolidated restaurant.

## Build
- Add a secure read-only ledger summary function that aggregates balances as of a date, respects existing tenant and branch access rules, and keeps unassigned ledger entries visible.
- Calculate assets on their debit-normal side and liabilities/equity on their credit-normal side.
- Include a computed accumulated earnings line from revenue less COGS and expenses so the accounting equation remains complete without duplicating closed earnings already moved into equity.
- Create a clinical-precision report page with an as-of date, branch selector, display-currency selector, summary totals, equation status, branch sections, account rows, empty/loading/error states, and CSV export.
- Add the page to Finance navigation, protected routing, Finance Dashboard quick links, breadcrumbs/page titles, and English/Arabic translations with RTL-safe layout.

## Technical details
- Report amounts remain stored in the restaurant base currency. The selected display currency uses the existing exchange-rate service and is clearly labeled in the report and export.
- Consolidated results include named branches plus an “Unassigned” bucket; selecting a branch scopes both totals and rows.
- Only posted ledger rows where `is_voided = false` and `transaction_date <= as-of date` are included.
- Validate with locale parsing, TypeScript, production build, and authenticated desktop/mobile checks when a preview session is available.
