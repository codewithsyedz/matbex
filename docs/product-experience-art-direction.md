# Matbex Product Experience — Clinical Precision Bento

## Direction

The signed-in product should feel like a precision operating instrument: calm, exact, tactile, and exceptionally legible. The visual system uses a clinical off-white canvas, ink typography, controlled emerald emphasis, Sora display type, and Manrope interface text.

## Audit findings and implementation rules

### 1. Typography

- Use Sora 600–700 only for page titles, section titles, and decisive financial values.
- Use Manrope 400–700 for navigation, labels, controls, tables, and supporting copy.
- Keep all numbers tabular so live values never shift surrounding layouts.
- Page titles use 30px on desktop and 24px on mobile; section titles use 18px; body copy uses 14px.
- Do not use light-weight headings in the product. They appear weak beside dense operational data.

### 2. Composition and hierarchy

- Every page begins with title, one-line context, and actions aligned to the same baseline.
- Use a maximum 1280px content canvas for analytical pages.
- Build dashboards as a command grid: one dominant analytical surface, supporting metrics, then detailed records.
- Keep primary actions emerald. Exports, settings, and other utilities remain outlined or icon-only.
- Place filters in one compact rail immediately above the data they control.

### 3. Surfaces and depth

- Use an off-white page canvas and white working surfaces separated by hairline green-grey borders.
- Use one restrained ambient shadow token; reserve the stronger shadow for hover and elevated overlays.
- Keep card radius at 8px. Avoid nested cards and decorative floating sections.
- Use pale emerald only for selected states, positive context, and focus—not as general decoration.

### 4. Navigation

- Use 40px minimum navigation rows with 14px medium labels.
- Mark the active destination with pale emerald, stronger text, and an inset emerald rule.
- Keep group labels small, bold, uppercase, and visually subordinate to destinations.
- Preserve sidebar position and expansion state across navigation.

### 5. Data display

- KPI labels are 11px uppercase; values are 24px Sora with tabular numerals.
- Table headers are 11px uppercase on a quiet tinted band; rows use compact 14px text and 54–56px height.
- Positive, warning, and destructive colors communicate state only. Never use them decoratively.
- Charts should use emerald for the active series and neutral green-grey for comparisons; grid lines stay quiet.

### 6. Interaction and motion

- Use 180–240ms transitions with ease-out timing.
- Buttons depress by one pixel; cards lift by one pixel and strengthen their border on hover.
- Focus rings remain visible and use a translucent emerald ring.
- Animate only opacity, transform, border, and shadow. No looping motion in operational screens.
- Respect reduced-motion preferences by presenting the final state immediately.

### 7. Responsive behavior

- Stack title and actions on narrow screens while keeping the primary action first.
- Convert four-column KPI grids to two columns on tablets and one column only when necessary.
- Tables may scroll horizontally, but page-level horizontal overflow is never acceptable.
- Every interactive target remains at least 40px high, with 44px preferred on touch screens.

## Rollout order

1. Done — shared shell, typography, navigation, controls, cards, tabs, inputs, and tables.
2. Done — Sales as the reference analytical screen.
3. Done — dashboard command grid, plus the shared page frame (1280px canvas, Sora page titles,
   filter rail above the data) applied across every signed-in screen.
4. Dense report tables and forms.
5. Dark-mode calibration, Arabic typography review, and mobile regression review.

### Shared page frame

Every signed-in page uses `container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6`,
a `font-display text-2xl md:text-3xl font-semibold` title with a one-line context beneath,
primary actions on the title baseline, and filters inside a `data-panel` rail.
Status text uses `text-success` / `text-warning`, never raw Tailwind colour utilities.
