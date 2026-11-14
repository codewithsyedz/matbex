import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useSuperAdmin } from "@/contexts/SuperAdminContext";
import { TenantSuspendedScreen } from "@/components/TenantSuspendedScreen";
import { MatbexLogoLoader } from "@/components/brand/MatbexLogo";
import { Capacitor } from "@capacitor/core";
import { logRouteGuard } from "@/lib/routeGuardLog";

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireOnboarding?: boolean;
}

// Routes cashiers are allowed to access
const CASHIER_ALLOWED_ROUTES = ["/shifts", "/record-sale", "/chat", "/online-orders", "/order-manager"];

// Routes accountants are allowed to access (finance & read-only operations)
const ACCOUNTANT_ALLOWED_ROUTES = [
  "/dashboard",
  "/finance-dashboard",
  "/accounting",
  "/reports",
  "/zatca-compliance",
  "/compliance",
  "/expenses",
  "/cogs",
  "/cogs-trueup",
  "/inventory-audit",
  "/inventory",
  "/ingredient-mappings",
  "/billing",
  "/audit-logs",
  "/settings",
  "/chat",
  "/settlements",
  "/customers",
  "/sales",
  // Posting closed sales days (Auto-post) lives here; accountants post them (finance role).
  "/daily-profit",
];

export function ProtectedRoute({ children, requireOnboarding = true }: ProtectedRouteProps) {
  const { user, loading, tenant, roles, hasRole, isManager, isOwner } = useAuth();
  const { isSuperAdmin, loading: superAdminLoading, isImpersonating } = useSuperAdmin();
  const location = useLocation();

  const snapshot = {
    hasUser: !!user,
    loading,
    superAdminLoading,
    hasTenant: !!tenant,
    roles,
    isSuperAdmin,
    isImpersonating,
    requireOnboarding,
  };
  const track = (
    decision: "allow" | "redirect" | "wait",
    reason: string,
    to?: string
  ) =>
    logRouteGuard({
      pathname: location.pathname,
      search: location.search,
      decision,
      reason,
      to,
      context: snapshot,
    });

  // Only show the fullscreen "Initializing..." loader on the true cold start
  // (no cached user yet). Once we have a user from hydration, subsequent
  // navigations or background context refreshes should NOT flash the
  // fullscreen logo loader on top of the route's own Suspense progress bar.
  if ((loading || superAdminLoading) && !user) {
    track("wait", "cold-start-auth-loading");
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <MatbexLogoLoader size={64} />
          <p className="text-sm text-muted-foreground font-light">Initializing...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    track("redirect", "no-user", "/auth");
    return <Navigate to="/auth" state={{ from: location }} replace />;
  }

  // Auth contexts may still be resolving tenant/roles even though a cached user
  // exists (hydration). Redirecting now would bounce deep links (e.g. a
  // notification action to /sales) to /onboarding and then to /dashboard.
  // Wait for resolution instead of guessing.
  const contextsSettled = !loading && !superAdminLoading;
  if (!contextsSettled && !tenant && roles.length === 0) {
    track("wait", "contexts-hydrating");
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <MatbexLogoLoader size={64} />
          <p className="text-sm text-muted-foreground font-light">Loading your workspace...</p>
        </div>
      </div>
    );
  }

  // SuperAdmin users should be redirected to admin portal - unless they're impersonating a tenant
  if (isSuperAdmin && !isImpersonating) {
    track("redirect", "superadmin", "/admin");
    return <Navigate to="/admin" replace />;
  }

  // Check if tenant is suspended (status now lives on tenant, not restaurant)
  if (tenant && tenant.status === "suspended") {
    track("wait", "tenant-suspended");
    return <TenantSuspendedScreen />;
  }

  // Check if user needs to complete onboarding (skip for SuperAdmins impersonating)
  // Native APK is POS-only: skip the tenant onboarding wizard entirely.
  if (
    requireOnboarding &&
    !isImpersonating &&
    !Capacitor.isNativePlatform() &&
    contextsSettled &&
    !tenant &&
    roles.length === 0 &&
    location.pathname !== "/onboarding"
  ) {
    track("redirect", "onboarding-required", "/onboarding");
    return <Navigate to="/onboarding" replace />;
  }

  // Cashier role restriction: only allow access to shifts and record-sale
  // Native APK now supports role-based access: owners/managers see the full app,
  // cashier-only users remain locked to the POS routes.
  const isCashierOnly = contextsSettled && hasRole("cashier") && !isManager && !isOwner;
  if (isCashierOnly) {
    const isAllowed = CASHIER_ALLOWED_ROUTES.some(route => location.pathname === route || location.pathname.startsWith(route + "/"));
    if (!isAllowed) {
      // Redirect cashiers to record-sale page if they try to access restricted routes
      track("redirect", "cashier-restricted", "/record-sale");
      return <Navigate to="/record-sale" replace />;
    }
  }

  // Accountant role restriction: only finance-related routes
  const isAccountantOnly = contextsSettled && hasRole("accountant") && !isManager && !isOwner;
  if (isAccountantOnly) {
    const isAllowed = ACCOUNTANT_ALLOWED_ROUTES.some(
      route => location.pathname === route || location.pathname.startsWith(route + "/")
    );
    if (!isAllowed) {
      track("redirect", "accountant-restricted", "/accounting");
      return <Navigate to="/accounting" replace />;
    }
  }

  track("allow", "granted");
  return <>{children}</>;
}
