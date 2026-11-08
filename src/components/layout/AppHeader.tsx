import { useAuth } from "@/contexts/AuthContext";
import { useRoleGuard } from "@/hooks/useRoleGuard";
import { RestaurantSwitcher } from "./RestaurantSwitcher";
import { BranchSwitcher } from "./BranchSwitcher";
import { Badge } from "@/components/ui/badge";
import { useIsMobile } from "@/hooks/use-mobile";
import { NotificationCenter } from "@/components/notifications/NotificationCenter";
import { LanguageSelector } from "@/components/landing/LanguageSelector";
import { RegionSelector } from "@/components/landing/RegionSelector";
import { OfflineStatusBadge } from "@/components/offline/OfflineStatusBadge";
import { LicenseStatusBadge } from "@/components/license/LicenseStatusBadge";
import { useEffect, useRef } from "react";
import { armOfflineAutoBootstrap, updateBranchIfOfflineStarted } from "@/lib/offline/lazyBootstrap";
import { DemoBadge } from "@/components/demo/DemoBadge";
import { useDemoTrial } from "@/hooks/useDemoTrial";
import { OnboardingLauncher } from "@/components/onboarding/OnboardingLauncher";
import { ThemeToggle } from "./ThemeToggle";

export function AppHeader() {
  const { tenant, plan, hasRole, restaurant } = useAuth();
  const { isCashierOnly } = useRoleGuard();
  const isMobile = useIsMobile();
  const { isDemo, daysLeft } = useDemoTrial();

  // Lazy offline boot:
  // - Do NOT load the offline stack on mount (saves bundle + IDB + SW work
  //   for users who never go offline).
  // - Arm a one-shot listener: if the browser fires `offline`, boot.
  // - If the offline layer is already running (user visited /offline-sync,
  //   POS, terminals, etc.), keep its branch id in sync.
  const branchRef = useRef<string | null>(null);
  branchRef.current = restaurant?.id ?? null;
  useEffect(() => {
    return armOfflineAutoBootstrap(() => branchRef.current);
  }, []);
  useEffect(() => {
    // Propagate branch changes only when the engine is already running.
    updateBranchIfOfflineStarted(restaurant?.id ?? null);
  }, [restaurant?.id]);

  return (
    <header className={`relative z-20 flex items-center justify-between h-16 px-4 md:px-6 border-b border-border/80 bg-background/92 shadow-[0_1px_0_hsl(var(--foreground)/0.025)] backdrop-blur-xl ${isMobile ? 'ps-16' : ''}`}>
      <div className="flex items-center gap-2 md:gap-4">
        {!isCashierOnly && <RestaurantSwitcher />}
        {!isCashierOnly && <BranchSwitcher />}
        {tenant && (
          <div className="hidden md:flex items-center gap-2 text-sm text-muted-foreground">
            <span>{tenant.name}</span>
            {plan && (
              <Badge variant="secondary" className="text-xs capitalize">
                {plan.name}
              </Badge>
            )}
            {isDemo && <DemoBadge />}
            {isDemo && daysLeft !== null && (
              <span className="text-xs tabular-nums text-warning">
                {daysLeft >= 0 ? `${daysLeft}d left` : "Expired"}
              </span>
            )}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        <OfflineStatusBadge />
        <LicenseStatusBadge />
        {!isCashierOnly && <OnboardingLauncher />}
        {!isCashierOnly && <LanguageSelector />}
        {!isCashierOnly && <RegionSelector />}
        <ThemeToggle />
        {hasRole("owner") && <NotificationCenter />}
      </div>
    </header>
  );
}
