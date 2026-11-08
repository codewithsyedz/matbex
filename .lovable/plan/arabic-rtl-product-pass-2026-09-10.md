# Arabic RTL product pass

## Goal
Make every signed-in Matbex screen read naturally in Arabic while preserving the clinical-precision density, workflows, permissions, branch scope, and light/dark themes.

## Implementation
1. **RTL foundation and typography**
   - Apply Noto Sans Arabic consistently to Arabic body and display text, with Arabic-appropriate weight, line height, and zero letter spacing.
   - Add shared RTL rules for logical alignment, directional spacing, scroll areas, tables, numeric data, menus, dialogs, sheets, tooltips, and form controls.
   - Keep dates, amounts, account codes, references, email addresses, phone numbers, and formulas readable with isolated left-to-right direction where needed.

2. **Navigation and shared shell**
   - Mirror the desktop sidebar and mobile navigation behavior, including collapse controls, chevrons, active markers, overlays, and edge spacing.
   - Correct header spacing, selector menus, notifications, breadcrumbs, command palette, banners, and floating controls in RTL.
   - Translate the remaining hardcoded navigation group and item labels using the shared language resources.

3. **Dashboard and shared data patterns**
   - Correct dashboard headings, action rows, filters, KPI cards, status badges, charts, tooltips, and operational panels for Arabic reading order.
   - Make dense tables use RTL labels while keeping numeric columns stable, aligned, and easy to compare.
   - Standardize Arabic empty, loading, error, confirmation, and validation states.

4. **Forms, reports, and operational screens**
   - Apply logical field alignment and mirrored action placement to forms, dialogs, drawers, tabs, date controls, and selectors.
   - Audit priority product areas: Sales, Expenses, Reports, Trial Balance, AP Aging, Inventory, Accounting, Staff, Payroll, POS, Settings, and administration.
   - Replace high-impact visible English copy with Arabic translations without changing business logic.

5. **Verification**
   - Run typecheck and production build.
   - Walk representative Arabic screens at desktop and phone widths in both light and dark modes.
   - Check for horizontal overflow, clipped labels, incorrect icon direction, mixed-direction number corruption, and runtime errors.

## Technical details
- Use semantic design tokens and shared component styles only; no hardcoded visual colors.
- Prefer CSS logical properties and `rtl:` variants over page-specific left/right overrides.
- Preserve intentionally LTR machine-readable values with `dir="ltr"` and Unicode isolation.
- Public marketing pages are outside this pass; signed-in product and admin screens are included.
