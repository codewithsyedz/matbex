# Matbex Motion System

Motion here has one job: make a dense operations product feel calm and deliberate. Every move is either **orientation** (where did this come from, where did it go) or **feedback** (I heard you). Nothing decorates. Nothing loops. Nothing blocks.

## 1. Tokens (`src/lib/motion/tokens.ts`)

**Curves — four, no more.**

| Token | Curve | Use |
| --- | --- | --- |
| `EASE.entrance` | `cubic-bezier(0.22, 1, 0.36, 1)` | Anything arriving: reveals, scenes, hero copy |
| `EASE.exit` | `cubic-bezier(0.4, 0, 1, 1)` | Anything leaving — always faster than the entrance |
| `EASE.ui` | `cubic-bezier(0.4, 0, 0.2, 1)` | Hover, press, toggles — symmetrical, no overshoot |
| `EASE.settle` | `cubic-bezier(0.16, 1.06, 0.3, 1)` | Panels and snaps that should carry weight |

**Durations.** `instant 120ms` · `quick 200ms` · `base 400ms` · `scene 650ms` · `cinematic 900ms`. Interaction never exceeds `base`; `cinematic` belongs to first paint only.

**Stagger.** `tight 45ms` (KPI cells, table rows) · `base 80ms` (cards, list items) · `loose 130ms` (headline lines, hero beats). A group's total entrance stays under ~900ms — cap the stagger on long lists rather than letting the tail drift.

**Travel.** `sm 10px` · `md 18px` · `lg 28px`. Depth, not flight. Elements never fly across the screen.

## 2. Page loading

1. Route swap: 250ms cross-fade with a 6px lift (`PageTransition`) — never a spinner for a route the app already has.
2. Skeletons match the final block's exact geometry, so the fill-in causes zero reflow.
3. The LCP element (hero headline) renders its default text immediately and animates only its transform; it never waits on data.
4. First-paint choreography runs once per session per page, gated on `document.visibilityState`.

## 3. Smooth scrolling

Native scrolling only. No hijacked scroll, no scroll-jacking library, no inertia emulation — those break trackpad expectations, mobile momentum, and find-in-page. Anchors use CSS `scroll-behavior: smooth` with `scroll-margin-top` sized to the fixed header, disabled under `prefers-reduced-motion`.

A 2px emerald progress needle (`ScrollProgress`) is the only persistent motion on the page, spring-damped so it trails scroll like a physical instrument.

## 4. Text reveals

`TextReveal` lifts each authored line out of its own clip mask (`y: 108% → 0`), `scene` duration, `loose` stagger. Lines are passed as an array, never split at runtime — no reflow, no broken screen-reader order, no orphaned characters. Body copy never masks; it uses a plain `Reveal` so reading is never gated on animation.

## 5. Image transitions

`ParallaxImage` renders the picture at 1.12 scale and eases it to 1 as its frame reaches viewport centre, opacity 0.55 → 1. Combined with a blur-up placeholder this reads as an image settling into its frame. Always `decoding="async"`, `loading="lazy"` below the fold, and fixed aspect boxes so nothing shifts.

## 6. Parallax and depth

`Parallax` offsets a layer by a fixed pixel budget across its scroll pass (foreground negative, background positive), spring-smoothed. Budget: **≤ 60px, two layers per section, never on text the user is reading.** Depth otherwise comes from light — border highlights, bloom, blur — not from big movement.

## 7. Pinned sections

Pinning is rationed to one moment per page: the mechanism section, where the surface holds while three steps advance. Implemented with `position: sticky` plus scroll-progress-driven opacity, not a scroll-locking library, so the user can always keep scrolling out. Disabled below `lg` and under reduced motion, where the steps simply stack.

## 8. Hover, press, cursor

- Buttons: `translateY(-1px)` + tonal shift, 200ms `EASE.ui`; press returns to 0 at 120ms. Never scale text.
- Cards: border and shadow only — geometry stays put so grids never wobble.
- `Magnetic` gives primary CTAs a ≤10px cursor lean with a spring return. Fine pointers only.
- The hero carries a soft emerald pointer spotlight at low opacity, rAF-throttled, removed on mouse leave.
- Every hover affordance has a non-hover equivalent; focus-visible rings are never animated away.

## 9. Scroll choreography

The page is a sequence of scenes. `Scene` fades and lifts a section as it enters (0.45 → 1 opacity, 22px) and dims it slightly on exit, so sections hand off rather than scroll past. Within a scene: eyebrow → heading lines → body → media → actions, on the `base` stagger. Reveals fire once, at 25% visibility with a −12% bottom margin, and never replay on scroll-up.

## 10. Accessibility

`prefers-reduced-motion: reduce` returns the final frame instantly at the component level — not a global override — so nothing disappears or lands mid-flight. Content is always present in the DOM regardless of animation state; reveals never gate text from assistive tech or search engines. No parallax on reading text, no flashing above 3Hz, no motion that conveys information on its own.

## 11. Performance budget

Transform and opacity only. `will-change` is set on animating elements and dropped after. No layout-affecting properties on scroll, no `scroll` listeners without rAF throttling, no per-frame React state (`useTransform`/`useSpring` write straight to style). Passive listeners. Target: 60fps on a mid-range Android, main thread free of long tasks during first scroll, and zero added blocking JS on the critical path.

## 12. Primitives

| Component | File | Purpose |
| --- | --- | --- |
| `Reveal` / `RevealGroup` / `RevealItem` | `src/components/motion/Reveal.tsx` | Scroll and mount entrances, staggered groups |
| `TextReveal` | `src/components/motion/TextReveal.tsx` | Masked line lift for headings |
| `Parallax` / `ParallaxImage` | `src/components/motion/Parallax.tsx` | Depth layers and settling imagery |
| `Scene` | `src/components/motion/Scene.tsx` | Section-level enter/exit hand-off |
| `ScrollProgress` | `src/components/motion/ScrollProgress.tsx` | Reading needle |
| `Magnetic` | `src/components/motion/Magnetic.tsx` | Cursor gravity for primary CTAs |

**Rule:** if a new animation needs a duration or curve that is not in `tokens.ts`, the design is wrong, not the token set.
