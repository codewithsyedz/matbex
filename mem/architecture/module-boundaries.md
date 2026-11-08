---
name: Module boundary enforcement (eslint-plugin-boundaries)
description: Prevents cross-feature coupling between accounting, POS, web-builder, etc.
type: constraint
---

Module boundaries enforced via `eslint.boundaries.config.js` (separate from main eslint to allow gradual rollout). Run `npm run lint:boundaries`.

**Element types:**
- `app` — `App.tsx`, `main.tsx`, route table
- `page` — `src/pages/**`
- `feature` — each folder under `src/components/*` (accounting, pos, web-builder, inventory, financials, staff, customers, expenses, shifts, menu, …)
- `shared` — `src/components/ui/**`, `src/lib/**`, `src/hooks/**`
- `context` — `src/contexts/**`
- `integration` — `src/integrations/**`

**Rules:**
- `page` → may import `feature`, `shared`, `context`, `integration`.
- `feature` → may import `shared`, `context`, `integration`, and **same-feature** siblings only. ❌ no cross-feature imports.
- `shared` → may import `shared`, `integration` only. ❌ no upward dependencies on `feature`/`page`/`context`.
- `context` → may import `shared`, `integration`, sibling `context`.

**Why:** 509 .tsx files with no module boundaries lead to circular deps and accidental coupling. Most dangerous coupling vectors observed: accounting reaching into POS hooks; web-builder importing financial KPI logic; shared `ui/` importing from feature folders.

**Phasing:**
- Rules start at `warn` to avoid blocking PRs with the day-1 baseline.
- Hard-fail on net-new violations via lint-staged.
- Promote to `error` once baseline reaches zero.

**Install:** `bun add -D eslint-plugin-boundaries` in CI.

**Don't:** import from `@/components/<other-feature>/*` inside a feature folder — use a shared hook in `@/hooks/` or a shared lib in `@/lib/` instead.