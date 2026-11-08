# Clinical precision dark mode

## Goal
Apply the authenticated product’s clinical emerald design consistently in light and dark themes without changing workflows or data behavior.

## Implementation
1. Refine global dark tokens for near-black green-neutral backgrounds, elevated surfaces, crisp borders, accessible text, status colors, charts, and focus rings.
2. Strengthen shared product primitives and shell styling so cards, tables, forms, menus, dialogs, sidebars, headers, and data panels inherit both themes consistently.
3. Normalize remaining light-only utility colors inside authenticated screens, prioritizing dashboard, Sales, Expenses, reports, accounting, POS, settings, and admin surfaces while preserving intentionally dark public marketing pages.
4. Verify theme persistence and representative screens in both modes at desktop and mobile widths; run typecheck and build checks.

## Technical notes
- Keep class-based theme switching and semantic design tokens as the source of truth.
- Scope compatibility overrides to the signed-in workspace so public ink-and-emerald pages are unchanged.
- Preserve branch-aware calculations, permissions, forms, dialogs, charts, and existing interactions.
- Maintain WCAG AA contrast, visible focus states, 44px mobile targets, and reduced-motion behavior.
