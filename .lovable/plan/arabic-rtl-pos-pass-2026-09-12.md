# Arabic RTL POS pass

## Scope
- Translate the active desktop and mobile POS order lines, totals, payment controls, customer settlement states, and sale confirmations.
- Translate receipt history, receipt preview, print/reprint actions, payment labels, dates, totals, and empty/error states.
- Replace left/right-specific alignment and spacing in these flows with RTL-safe logical alignment while preserving intentionally fixed receipt/QR print surfaces.
- Keep the existing clinical dark styling, branch pricing, VAT calculations, offline queue, payments, and printing behavior unchanged.

## Implementation
- Extend the existing `app.pos` English and Arabic translation dictionaries with order, payment, terminal, and receipt namespaces.
- Wire remaining visible strings in the desktop/mobile sale screens and receipt history to those keys.
- Localize known size and payment values for display without changing their stored database values.
- Use the active language for dates and ensure receipt metadata remains readable in both directions.

## Verification
- Validate both locale files and run the TypeScript check.
- Inspect Arabic dark-mode POS at desktop and phone sizes for RTL direction, untranslated labels, clipping, and horizontal overflow.
- Confirm the preview build remains clean.
