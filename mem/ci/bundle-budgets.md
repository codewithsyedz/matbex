---
name: Bundle size budgets enforced in CI
description: size-limit thresholds protecting FCP from accidental large imports
type: constraint
---

Bundle budgets in `.size-limit.json`, enforced via `npm run lint:bundle`:

- **Initial JS** (`dist/assets/index-*.js`, gzipped): **< 250 KB**
- **Largest route chunk** (any single chunk, excluding initial): **< 120 KB gzip**
- **Total app JS**: **< 1.2 MB gzip**

**Why:** Vite manual chunking and route-level `React.lazy` exist (see `mem://performance/vite-optimization-architecture`), but nothing enforced them. A single `import * from 'lodash'` or full-package import regressed FCP repeatedly. Budgets fail CI when crossed.

**How to apply:**
- Never add `lodash`, `moment`, full `date-fns`, or any package > 50 KB gzip without a named import + tree-shaking confirmation.
- New route → confirm it lands in its own chunk (`React.lazy` + `Suspense`).
- Before merging a large feature, run `npm run build && npm run lint:bundle` locally.
- Forbidden: `recharts` outside the lazy-loaded analytics chunks; `framer-motion` in pages other than via `AnimatedRoutes`.

**Install:** `bun add -D size-limit @size-limit/preset-app` in CI.