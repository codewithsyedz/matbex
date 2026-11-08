import { useAuth } from "@/contexts/AuthContext";

/**
 * Reusable role-guard helpers derived from AuthContext.
 * Prefer these over inline `hasRole` chains so permission logic
 * stays consistent and easy to refactor in one place.
 */
export function useRoleGuard() {
  const { hasRole } = useAuth();

  /**
   * True when the user holds *only* the cashier role (no owner/manager).
   * Used to hide analytics surfaces (ticker, dashboard, etc.) that cashiers
   * should never see - their UI is strictly POS/shift screens.
   */
  const isCashierOnly =
    hasRole("cashier") && !hasRole("owner") && !hasRole("manager");

  /**
   * True when the user holds *only* the accountant role (no owner/manager).
   * Accountants get finance-scoped views but should not see operational
   * KPI tickers or live POS analytics meant for floor managers.
   */
  const isAccountantOnly =
    hasRole("accountant") && !hasRole("owner") && !hasRole("manager");

  /**
   * True for any owner or manager - the canonical "can see everything
   * operational" role check. Use for analytics cards, dashboards, and
   * cross-cutting KPIs.
   */
  const canViewOperationalAnalytics = hasRole("owner") || hasRole("manager");

  /**
   * Convenience: hide analytics surfaces from cashier-only users.
   * Equivalent to `isCashierOnly` but named for the rendering site so
   * call sites read intent ("hide this card") rather than role math.
   */
  const hideAnalyticsForCashier = isCashierOnly;

  return {
    isCashierOnly,
    isAccountantOnly,
    canViewOperationalAnalytics,
    hideAnalyticsForCashier,
  };
}

/**
 * Wrapper that renders `children` only for users allowed to see
 * operational analytics. Cashier-only users see `fallback` (default: null).
 *
 * Use to gate dashboard cards, KPI widgets, and any analytics surface
 * without sprinkling `useRoleGuard` checks across every component.
 */
export function AnalyticsGuard({
  children,
  fallback = null,
}: {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const { isCashierOnly } = useRoleGuard();
  if (isCashierOnly) return <>{fallback}</>;
  return <>{children}</>;
}
