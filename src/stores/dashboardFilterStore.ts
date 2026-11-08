import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

/**
 * Persists the dashboard's currently selected date range so that
 * background prefetchers (e.g. usePrefetchRoute) can warm the same
 * cache keys the dashboard will actually request, instead of
 * always defaulting to "today".
 *
 * Stored in sessionStorage so it resets per browser session but
 * survives navigation between routes.
 */
export interface DashboardDateRange {
  from: string; // ISO date
  to: string;   // ISO date
  preset: string;
}

interface DashboardFilterStoreState {
  dateRange: DashboardDateRange | null;
  setDateRange: (range: DashboardDateRange | null) => void;
}

export const useDashboardFilterStore = create<DashboardFilterStoreState>()(
  persist(
    (set) => ({
      dateRange: null,
      setDateRange: (range) => set({ dateRange: range }),
    }),
    {
      name: "matbex:dashboard-filter",
      storage: createJSONStorage(() => sessionStorage),
    },
  ),
);

/** Non-reactive read for use outside React (prefetch helpers). */
export function getDashboardDateRange(): DashboardDateRange | null {
  return useDashboardFilterStore.getState().dateRange;
}