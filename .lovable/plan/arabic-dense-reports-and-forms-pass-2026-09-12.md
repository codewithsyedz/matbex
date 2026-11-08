# Arabic dense reports and forms pass

## Goal
Translate the dense accounting reports and operational forms into complete Arabic, with precise RTL layout and the same clinical light/dark styling, without changing calculations or workflows.

## Build
- Add organized Arabic and English translation groups for report titles, filters, summary metrics, table headers, row statuses, empty states, dialogs, validation, actions, and notifications.
- Localize the priority dense reports: Trial Balance, AP Aging, VAT Audit, Daily Reconciliation, Supplier Ledger, Inventory Audit, and report scheduling.
- Localize the priority dense forms: journal entries, expenses, purchases, receipts, suppliers, fixed assets, COGS, ZATCA, and tenant configuration.
- Replace physical left/right alignment and spacing in touched screens with logical RTL-safe styling while keeping financial figures stable and tabular.
- Preserve database values, exported identifiers, accounting logic, permissions, branch/date filters, and print-safe output.

## Verification
- Validate locale JSON, TypeScript, and the production build.
- Walk representative Arabic report and form screens in dark mode on desktop and mobile; confirm RTL direction, translated visible labels, usable wide-table scrolling, dialog fit, and no horizontal page overflow.
