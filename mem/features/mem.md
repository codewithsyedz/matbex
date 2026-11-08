---
name: Dashboard Filter Mirror Store
description: Persisted dashboard date range used by prefetchers to warm correct cache keys
type: feature
---
The dashboard's selected date range (preset + from/to ISO) is mirrored into
`useDashboardFilterStore` (Zustand + sessionStorage, key `matbex:dashboard-filter`).

- `src/pages/Index.tsx` writes to it whenever `filters.dateRange` or `filters.preset` changes.
- `src/hooks/usePrefetchRoute.ts` reads it via `getDashboardDateRange()` in `dashboardBounds()`
  so background prefetches use the same date range the dashboard will actually query.
  Falls back to "today" when nothing is stored yet.

Any new dashboard prefetch logic MUST read from this store (not hardcode "today")
to ensure cache hits on navigation.
