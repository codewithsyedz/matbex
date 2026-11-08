# Dense reports and forms rollout

## Goal
Bring authenticated report tables and operational forms into the same clinical-precision system as the dashboard: compact, scannable, responsive, and theme-safe without changing workflows or calculations.

## Build
- Refine shared table primitives with compact density, stable headers, numeric alignment helpers, clear row states, and intentional horizontal scrolling on narrow screens.
- Refine shared form primitives with compact labels, descriptions, validation, focus states, and consistent field rhythm.
- Apply the system first to high-density accounting reports, including Trial Balance and AP Aging, with dashboard-style filter rails, summaries, and readable wide tables.
- Apply the same structure to representative complex forms and dialogs, including report scheduling and asset-class templates.
- Preserve branch/date filtering, exports, accounting logic, permissions, localization, and light/dark themes.

## Responsive and accessibility
- Keep controls at accessible touch sizes, preserve keyboard focus and table semantics, and use semantic color tokens only.
- On mobile, stack filter controls, keep primary actions visible, and scroll genuinely wide financial matrices rather than compressing values.

## Verification
- Run typecheck and production build.
- Inspect representative report and form screens in light and dark themes at desktop and mobile widths; check overflow, clipping, console errors, and dialog usability.
