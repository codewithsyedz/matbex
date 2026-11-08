# Matbex Hero — Art Direction

**Concept: "Service Line."** The first screen is the pass at 8pm — dark room, one clean light, everything moving in order. Not a software screenshot on white; a controlled, lit object in space.

## Scene
Deep ink field (#050D0A → #0A1712) with a single emerald light source behind the right shoulder of the composition, falling off into darkness. A hairline dot-lattice reads like a kitchen tile grid at grazing light. Fine film grain keeps the gradients from banding and gives the surface a printed, physical quality.

## Composition
Asymmetric split at 1.05fr / 1fr. Left: eyebrow, headline, lead, actions, trust line — a single vertical rhythm on one baseline. Right: the product rendered as a **glass slab**, not a screenshot — translucent surface, 1px light-catching border, soft emerald bloom underneath, tilted imperceptibly toward the reader. Two floating status cards break the slab's silhouette so it reads as depth, never as a flat image.

## Typography
Display 68/40, weight 300, tracking -0.035em — light weight at large size is the luxury signal. Second line drops to a muted slate, the final word carries emerald. Eyebrow: 11px, uppercase, 0.16em tracking. Lead: 19px, weight 300, 1.7 line-height, 58ch max. Numbers are tabular everywhere.

## Lighting & atmosphere
One key (emerald, top-right, 55% falloff), one cool fill (bottom-left, 8%), everything else absorbed by the ink. Panel edges catch a 1px highlight along the top and left. The bottom 160px dissolves into the page white so the next section arrives as dawn, not as a cut.

## Entrance
Curtain-lift, 900ms total: grid and glow fade in first (0ms) → headline lines rise from a clip mask, 90ms apart → lead → actions → slab lifts and settles (y 28→0, 700ms) → KPI values count once → status cards drift in last. Nothing loops. `prefers-reduced-motion` gets the final frame instantly.

## Cursor
A soft emerald spotlight tracks the pointer across the field at 12% opacity, lagging slightly for weight. Fine pointers only; disabled on touch and for reduced motion. Hover on the slab tips it 0.4° toward the cursor.

## Scroll
The slab parallaxes up ~40px slower than the copy, the glow dims, and the whole hero fades to 0.6 opacity as the compliance strip takes over. Transform/opacity only — no layout work on scroll.

## Message & CTA
Primary: the promise in the headline, the mechanism in one sentence beneath. Single emerald CTA ("Start free trial") with a ghost "Watch demo" beside it; sign-in demoted to the header. Trust line under the fold-line: ZATCA-ready · Multi-branch · Arabic & English.
