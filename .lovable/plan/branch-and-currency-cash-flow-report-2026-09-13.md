# Branch and currency cash flow report

## Goal
Build a ledger-backed Cash Flow page that presents operating, investing, and financing movements by branch and currency, matching the Balance Sheet’s clinical report layout and Arabic RTL behavior.

## Implementation
1. Add a secure reporting function that reads only posted, non-voided ledger entries within the authorized tenant and optional branch, calculates opening and closing cash, and returns activity movements grouped by branch and currency.
2. Replace the current client-derived cash-flow hook with grouped branch results, consolidated totals, reconciliation variance, loading, and error handling.
3. Rebuild the Cash Flow page to match the Balance Sheet: branch/date/currency controls, consolidated and branch cards, activity tables, cash-account reconciliation, CSV export, responsive dense tables, and clear empty/error states.
4. Add complete English and Arabic copy, RTL-safe alignment and spacing, translated movement descriptions, navigation naming, and localized dates.
5. Verify database permissions, type safety, locale validity, build output, and authenticated desktop/mobile rendering in English and Arabic.

## Technical notes
- Keep the indirect method: net income adjusted by non-cash balance movements.
- Classify fixed/non-current assets as investing, equity and long-term debt as financing, and remaining movements as operating.
- Treat cash, bank, and petty-cash accounts as cash equivalents; exclude card-settlement receivables.
- Convert only for display using the existing currency service; preserve each branch’s ledger currency in source rows and exports.
- Preserve branch authorization, tenant isolation, posted-only ledger rules, and accounting feature gating.
