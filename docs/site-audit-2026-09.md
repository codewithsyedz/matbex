# Matbex.com — Full Site Audit (Sept 2026)

Scope: public landing experience (`/`, `/ar`) at 1280px and 390px, plus head metadata,
crawl files, console health and conversion path. Ranked by revenue/impact.

---

## P0 — Fix before launch

| # | Issue | Evidence | Exact fix | Status |
|---|-------|----------|-----------|--------|
| 1 | FAQ headline printed a duplicated word ("Zero-friction onboarding onboarding") | 1280px screenshot | `landing.faqSection.title` → "Zero-friction", `titleBold` stays "onboarding" (en + ar) | Fixed |
| 2 | Mobile top bar was transparent over dark copy — logo, nav and text collided | 390px scroll @1500px | Header frosts at `bg-[#07100C]/95` (`/80` with backdrop-filter) on landing routes | Fixed |
| 3 | Language/currency chips rendered as light-grey pills on the ink header | 390px + 1280px | Chips inherit `bg-white/[0.06] border-white/15` when the bar is over dark | Fixed |
| 4 | Sitemap listed `/onboarding`, `/admin`, `/payment-success` while robots.txt disallows them | `public/sitemap.xml` vs `public/robots.txt` | Removed those three `<url>` entries — conflicting signals waste crawl budget | Fixed |
| 5 | Flag glyphs in the currency selector render as tofu boxes (`□□ SAR`) on Windows/Chromium | 1280px screenshot | Replace emoji flags with a 2-letter country code or an inline SVG flag set | Open |

## P1 — High impact, do this week

| # | Issue | Why it matters | Exact fix |
|---|-------|----------------|-----------|
| 6 | Console floods with `Function components cannot be given refs` on every load | Masks real errors, signals sloppiness in any shared session | Trace the ref-receiving child under `TooltipProvider` in `src/App.tsx` and wrap it in `React.forwardRef`, or drop the `ref` at the call site |
| 7 | Mobile page is 19,868px tall — ~10 phone screens before the pricing CTA | Scroll depth is the top conversion leak on long SaaS pages | Halve section padding under `md` in `src/styles/landing-lux.css` (`py-32` → `py-16`), collapse the bento grid to the 6 strongest tiles on mobile, and move Pricing above Testimonials on small screens |
| 8 | 21 tap targets below 40×40px on mobile | Fails WCAG 2.5.8 and costs taps on the nav + FAQ rows | Add `min-h-11 min-w-11` to icon buttons, FAQ toggles and footer links |
| 9 | No sticky CTA on mobile | Only CTA is in the hero and near the footer | Add a bottom sticky bar (`Start Your Residency` + `Talk to the team`) that appears after the hero leaves the viewport |
| 10 | Single conversion story, no proof density near the CTA | Testimonials sit far from pricing | Repeat one quote + the ZATCA/Saudi-Made badges directly beside the pricing table |

## P2 — Polish

| # | Issue | Fix |
|---|-------|-----|
| 11 | Scene fade choreography still dims content slightly at section edges | Already softened to 0.72→1→0.82; consider disabling handoff below `md` where scroll is faster |
| 12 | Fonts load from Google (`Inter`, `Noto Sans Arabic`, plus Space Grotesk/DM Sans in the lux layer) | Self-host `woff2` subsets in `public/fonts` and `font-display: swap`; removes 2 third-party round-trips from the critical path |
| 13 | No LCP preload | The hero is text-first, so mark the H1 container and preload the hero glow asset only if it becomes an image |
| 14 | Testimonial carousel is not keyboard reachable | Add prev/next buttons with `aria-label` and pause-on-focus |
| 15 | Section headings use decorative two-tone spans | Ensure the muted half still passes 4.5:1 on `#07100C` (currently ~#8A928C — borderline; lift to `#A7AEA9`) |
| 16 | No `prefers-reduced-data` / low-end fallback for blur layers | Gate `backdrop-blur-xl` behind `supports` + a `md:` breakpoint |

## What already passes

- One `<h1>`, one `<main>`, no unlabeled buttons, no images missing `alt`.
- Head metadata is complete: real title/description, OG + Twitter cards, 1200×630 `og:image`, manifest, full favicon set, Google verification, per-route canonicals via Helmet.
- `robots.txt` covers Googlebot, social unfurlers and AI crawlers, and blocks the app surfaces.
- Sitemap carries `hreflang` en/ar/x-default pairs.
- Arabic RTL is wired end to end; currency and region switch live.
- Build is clean (`build OK`), no runtime exceptions during a full-page scroll.

---

## Launch checklist

**Mobile**
- [ ] Section padding halved under `md`; page height under ~12,000px
- [ ] Sticky bottom CTA after hero
- [ ] All tap targets ≥44×44
- [ ] Test on iOS Safari (backdrop-filter, 100dvh, safe-area insets) and Android Chrome
- [ ] Arabic RTL pass at 390px

**CTAs**
- [ ] Primary CTA wording identical in hero, pricing and sticky bar
- [ ] Every CTA lands on `/register` with a source parameter
- [ ] Contact form success + error states verified, reply SLA honest

**Analytics**
- [ ] Page-view + scroll-depth events
- [ ] Click events on each CTA, pricing toggle, FAQ open, demo video play
- [ ] Contact form submit conversion
- [ ] Search Console + sitemap re-submitted after publish

**Assets**
- [ ] Fonts self-hosted and subset
- [ ] `og-image.png` confirmed live at 1200×630 and under 300KB
- [ ] Favicon/manifest icons verified on install
- [ ] No emoji-dependent UI (flags)

**Performance**
- [ ] Initial JS gzip under the 250KB budget
- [ ] Lighthouse mobile ≥90 performance, ≥95 accessibility
- [ ] No console errors on load

**Deployment**
- [ ] Publish (head/meta and sitemap changes only reach matbex.com on publish)
- [ ] `www.matbex.com` → `matbex.com` redirect confirmed
- [ ] 404 route styled to match the dark canvas
- [ ] Re-scan SEO and re-fetch link previews
