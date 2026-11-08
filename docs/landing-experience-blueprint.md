# Matbex Landing Experience Blueprint

Scope: home, pricing, feature/solution pages, company & resource pages.
Ambition level 3 of 5 — evolve the current clinical-emerald identity, do not replace it.

---

## 0. Global system

**Narrative spine (home):** Tension → Proof of control → Mechanism → Breadth → Trust → Offer → Objections → Commit.
Each section answers the question the previous one raises, so scrolling feels like a conversation, not a catalogue.

**Type scale (desktop / mobile)**
- Display 64 / 40, tracking -0.03em, weight 600
- Section head 40 / 28, tracking -0.02em
- Lead 19 / 17, line-height 1.65, weight 300
- Body 15 / 15, muted foreground
- Eyebrow 11, uppercase, tracking 0.12em, emerald

**Rhythm:** sections alternate `bg-background` and a 2% emerald wash. Vertical padding 120 / 72 mobile. Max content width 1200, prose 720.

**Motion register:** restrained, physical, 200–250ms, `cubic-bezier(.22,.61,.36,1)`.
- Reveal: opacity 0→1 + y 16→0, once, 60ms stagger per child, IntersectionObserver at -15% margin.
- Hover: 1.5–2% lift + shadow, never scale text.
- Numbers count up only once, 700ms, and only when the section is in view.
- Every animation wrapped in `prefers-reduced-motion` — reduced users get final state instantly.

**Accessibility:** single H1 per page, ordered H2/H3, 4.5:1 minimum contrast (emerald text only on white, white text only on #007a3d or darker), visible focus ring on every interactive element, decorative product mocks marked `aria-hidden`, carousels keyboard operable with pause control.

**Performance budget:** hero paints with zero images (CSS/DOM mock only), below-fold sections lazy-mounted, all imagery AVIF/WebP with width/height and `loading="lazy"`, animation limited to transform/opacity, no layout-shifting reveals.

---

## 1. Home page, section by section

### 1.1 Header (persistent)
Transparent over hero, then on scroll past 40px gains blur + hairline border + white 88% background (150ms). Links: Product, Pricing, Solutions, Resources, then language, currency, Sign in, and one emerald primary CTA. Mobile: full-height sheet, CTA pinned to bottom.
*Purpose:* keep the primary action one tap away at every scroll depth.

### 1.2 Hero — "the tension"
Left column: eyebrow pill, display headline with the second line in muted grey for cadence, 2-line lead, primary CTA + text "Watch demo", trust line (ZATCA-ready · Multi-tenant · High-volume).
Right column: a single, clean live-dashboard mock. **Fix required:** floating alert chips currently overlap the card title; they must sit outside the card bounds on ≥1024px and be suppressed below 1024px.
Motion: headline lines rise in sequence (0/80/160ms); mock fades and lifts at 240ms; KPI numbers tick once; alert chips drift in at 900ms and then hold — no looping.
*Purpose:* state the promise and hand the visitor an immediate visual of the payoff.

### 1.3 Compliance strip
Thin band directly under hero: ZATCA, Saudi-made, multi-branch, Arabic/English. Greyscale marks, no animation beyond a soft fade.
*Purpose:* remove the "is this legitimate here?" doubt before any reading effort.

### 1.4 Mission statement
Full-width quiet band, one sentence at 32/24 with generous leading, emerald keyword emphasis.
*Purpose:* a breath between claim and evidence; sets the operator-first tone.

### 1.5 Bento grid — "proof of control"
6 tiles, asymmetric: one large live-P&L tile, two medium (COGS, payroll), three small (inventory, ZATCA, offline POS). Each tile has a micro-visual, a 4-word title, one clarifying line. Hover lifts the tile and reveals a "See how" link.
*Purpose:* breadth in one screen, at browse speed.

### 1.6 Feature sections — "the mechanism"
Three alternating text/visual rows (COGS truth, Payroll and labour, Ledger that closes itself). Sticky visual column on desktop while the copy scrolls; stacked on mobile. Each row ends with a quiet inline link, not a competing button.
*Purpose:* convert interest into understanding of how it actually works.

### 1.7 Online ordering + venue types
Ordering block (menu, kiosk, aggregators) then a compact venue chip row — cafés, casual dining, cloud kitchens, multi-branch groups — each chip linking to the matching solution page.
*Purpose:* self-identification; "this is built for my kind of place."

### 1.8 Tools stack
Integration lattice on a soft grid; logos fade in on scroll, hover reveals the integration name.
*Purpose:* neutralise the switching-cost objection.

### 1.9 Testimonials
One quote at a time, large type, operator name, venue, branch count. Auto-advance 7s with pause on hover/focus, arrows and dots, swipeable.
*Purpose:* transfer credibility from peers.

### 1.10 Founding offer
Existing founding banner, moved here — after value is established, before the price grid. Counter animates once; button disabled with a clear label when exhausted.
*Purpose:* scarcity that reads as reward, not pressure.

### 1.11 Pricing table
Monthly/annual toggle, three plans, middle plan raised with an emerald ring and "Most popular". Feature rows use plain operator language. Under the grid: "All plans include" strip + a "Compare all features" link to the pricing page.
*Purpose:* the decision moment.

### 1.12 FAQ
Accordion, 8 questions max, one open by default, keyboard operable, FAQ JSON-LD retained.
*Purpose:* clear the last objections without a sales call.

### 1.13 Final CTA + contact
Emerald-washed closing band: one headline, one line, one primary CTA, one secondary "Talk to us". Footer follows with the four-column link hierarchy.
*Purpose:* single, unambiguous commit point.

**Section order change:** pricing currently renders immediately after the hero. It moves to position 1.11 via the CMS `sort_order`, so proof precedes price.

---

## 2. Pricing page
Hero (headline + toggle) → plan grid → full comparison table with sticky header row and sticky first column → founding offer → ROI/savings note → pricing FAQ → final CTA.
Motion: only the toggle animates (200ms crossfade of amounts). Everything else is static for scan speed.
Mobile: plans become a horizontal snap carousel; the comparison table becomes per-plan stacked lists.

## 3. Feature / solution pages
A repeatable template: focused hero (problem in the headline) → "before/after" pair → three mechanism blocks → one operator quote → related features → CTA band identical to home. Each page owns a distinct H1, meta description, and internal links to two sibling pages.

## 4. Company & resource pages
Shared narrow layout (720 prose, 1200 for indexes): page hero with eyebrow + title + one-line summary → content → contextual CTA band. Blog and help indexes use a card grid with reading time; article pages get a sticky table of contents on desktop and breadcrumbs everywhere.

---

## 5. Build order
1. Hero fixes (chip overlap, sequenced reveal, reduced-motion) + header scroll state
2. Home section order and rhythm/spacing system
3. Bento, feature rows, testimonials, final CTA polish
4. Pricing page comparison and mobile behaviour
5. Feature/solution and company/resource templates
6. Accessibility and performance pass with measurement
