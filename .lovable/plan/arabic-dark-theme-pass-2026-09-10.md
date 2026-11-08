# Arabic dark-theme pass

## Scope
Complete the signed-in Arabic experience for Dashboard, Sales, Expenses, and both desktop/mobile till screens without changing accounting, sales, or sync behavior.

## Build
- Replace remaining visible English copy, labels, tooltips, empty states, dialogs, filters, table headings, and notifications with shared English/Arabic translation keys.
- Localize till navigation, menu search/categories, variants, cart, payments, customer credit, receipts, offline/sync states, settings, and lock/day-end controls.
- Correct RTL composition using logical alignment and spacing while keeping prices, account codes, dates, receipt numbers, and device values safely left-to-right.
- Preserve the clinical dark theme through existing semantic tokens and shared components; remove light-only surfaces from these screens where found.
- Keep responsive density and touch targets usable on desktop, tablet, and phone.

## Validation
- Run typecheck and production build.
- Open the four target areas in Arabic dark mode at desktop and phone sizes, checking direction, overflow, untranslated interface copy, dialogs, and till interactions.
- Fix any build or runtime errors found during verification.

## Technical details
Translation strings will live in the existing `app.dashboard`, `app.sales`, `app.expenses`, and `app.pos` resource groups. Existing business logic, permissions, branch filters, offline queues, and ledger behavior remain unchanged.
