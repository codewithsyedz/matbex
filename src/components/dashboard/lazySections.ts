import { lazy } from "react";

/**
 * Code-split every heavy dashboard section. Each section ships in its own
 * chunk so the initial dashboard route is small and individual sections
 * load - and fail - independently without blocking navigation.
 */

export const LazyDailyProfitCard = lazy(() =>
  import("./DailyProfitCard").then((m) => ({ default: m.DailyProfitCard })),
);

export const LazyMonthlyKPICards = lazy(() =>
  import("./MonthlyKPICards").then((m) => ({ default: m.MonthlyKPICards })),
);

export const LazyMonthlyStatsCards = lazy(() =>
  import("./MonthlyStatsCards").then((m) => ({ default: m.MonthlyStatsCards })),
);

export const LazyDailySalesCard = lazy(() =>
  import("./DailySalesCard").then((m) => ({ default: m.DailySalesCard })),
);

export const LazyDailyExpensesCard = lazy(() =>
  import("./DailyExpensesCard").then((m) => ({ default: m.DailyExpensesCard })),
);

export const LazyDailyOverheadCard = lazy(() =>
  import("./DailyOverheadCard").then((m) => ({ default: m.DailyOverheadCard })),
);

export const LazyPendingSettlementsCard = lazy(() =>
  import("./PendingSettlementsCard").then((m) => ({
    default: m.PendingSettlementsCard,
  })),
);

export const LazyTopSellersCard = lazy(() =>
  import("./TopSellersCard").then((m) => ({ default: m.TopSellersCard })),
);

export const LazyPrimeCostCard = lazy(() =>
  import("./PrimeCostCard").then((m) => ({ default: m.PrimeCostCard })),
);

export const LazyOwnerDashboardAlerts = lazy(() =>
  import("./OwnerDashboardAlerts").then((m) => ({
    default: m.OwnerDashboardAlerts,
  })),
);

export const LazyDashboardQuotaAlerts = lazy(() =>
  import("./DashboardQuotaAlerts").then((m) => ({
    default: m.DashboardQuotaAlerts,
  })),
);

export const LazyOverheadDuplicateWarning = lazy(() =>
  import("./OverheadDuplicateWarning").then((m) => ({
    default: m.OverheadDuplicateWarning,
  })),
);

export const LazyMilestoneCelebration = lazy(() =>
  import("./MilestoneCelebration").then((m) => ({
    default: m.MilestoneCelebration,
  })),
);
export const LazyAllBranchesTotalsCard = lazy(() =>
  import("./AllBranchesTotalsCard").then((m) => ({
    default: m.AllBranchesTotalsCard,
  })),
);
export const LazyMonthlyGroupTotalsCard = lazy(() =>
  import("./MonthlyGroupTotalsCard").then((m) => ({
    default: m.MonthlyGroupTotalsCard,
  })),
);
