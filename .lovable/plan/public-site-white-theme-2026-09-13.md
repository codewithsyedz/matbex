# Public-site white theme

## Goal
Make the sun setting render the entire public Matbex site as a polished white-and-emerald theme, while the moon setting keeps the existing ink-and-emerald appearance.

## Implementation
1. Convert the shared public-site palette to theme-aware tokens for page backgrounds, raised surfaces, text, borders, controls, shadows, and article content.
2. Update the shared public page wrapper and header so they follow the active setting rather than always forcing the black canvas.
3. Adapt the landing hero and remaining dark-only shared elements for strong contrast in both themes without changing content, layout, or interactions.
4. Verify the switch persists and inspect representative landing, pricing, and content pages in both modes at desktop and phone widths.

## Technical notes
- Keep the existing class-based theme setting and persistent preference.
- Preserve Matbex emerald, current motion, RTL behavior, accessibility, and reduced-motion support.
- Scope changes to public-site presentation; signed-in product behavior remains unchanged.
