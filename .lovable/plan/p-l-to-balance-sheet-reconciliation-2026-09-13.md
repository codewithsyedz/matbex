# P&L to Balance Sheet Reconciliation

## Build
- Split the balance sheet’s computed earnings into opening retained earnings and current-period earnings for a selected reporting period.
- Add a P&L reconciliation table comparing each branch’s net profit with the matching current-period equity line, including retained earnings, total equity, variance, and status.
- Carry the P&L dates and branch into the Balance Sheet so the same figures remain visible when opened there.
- Add complete English and Arabic RTL labels and responsive table behavior.

## Technical details
- Reuse the secured ledger-backed Balance Sheet and P&L report functions; no ledger entries will be created or changed.
- Calculate opening retained earnings through the day before the P&L start date, then derive current-period earnings as closing accumulated earnings minus opening retained earnings.
- Treat differences below 0.01 in branch currency as reconciled.
- Validate type safety, production build, desktop/mobile layout, and Arabic RTL rendering.
