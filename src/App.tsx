import { lazy, Suspense, useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import {
  queryPersister,
  isPersistableQuery,
  PERSIST_BUSTER,
  PERSIST_MAX_AGE,
} from "@/lib/queryPersist";
import { BrowserRouter } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import { AuthProvider } from "@/contexts/AuthContext";
import { BranchProvider } from "@/contexts/BranchContext";
import { SuperAdminProvider } from "@/contexts/SuperAdminContext";
import { LicenseProvider } from "@/contexts/LicenseContext";
import { RegionProvider } from "@/contexts/RegionContext";
import { LanguageRegionProvider } from "@/contexts/LanguageContext";
import { AnimatedRoutes } from "@/components/AnimatedRoutes";
import { DegradedModeBanner } from "@/components/system/DegradedModeBanner";
import { CookieConsentBanner } from "@/components/system/CookieConsentBanner";
import { TenantQueryInvalidator } from "@/components/system/TenantQueryInvalidator";
import { KioskUnlockListener } from "@/components/pos/KioskUnlockListener";
import { PerfInstrumentation } from "@/components/perf/PerfInstrumentation";
import { HeadSync } from "@/components/seo/HeadSync";
import { installGlobalErrorReporter } from "@/lib/errorReporter";
import { installImpersonationFetchGuard } from "@/lib/impersonationFetchGuard";

// Dev / global watchdogs that don't affect first paint — defer them.
const PointerLockWatchdog = lazy(() =>
  import("@/components/PointerLockWatchdog").then((m) => ({ default: m.PointerLockWatchdog })),
);
const RuntimeAuditPanel = lazy(() =>
  import("@/components/a11y/RuntimeAuditPanel").then((m) => ({ default: m.RuntimeAuditPanel })),
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      // PERFORMANCE: Cache data for 2 minutes to reduce redundant API calls
      staleTime: 2 * 60 * 1000,
      // Keep data in cache for 10 minutes even after unmount
      gcTime: 10 * 60 * 1000,
      // Retry network/5xx issues, but don't retry 4xx (usually query/config bugs)
      retry: (failureCount, error: any) => {
        const status = (error as any)?.status;
        const code = (error as any)?.code;

        if (typeof status === "number" && status >= 400 && status < 500) return false;
        if (typeof code === "string" && code.startsWith("PGRST")) return false;

        return failureCount < 2;
      },
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    },
  },
});

const App = () => {
  useEffect(() => {
    installGlobalErrorReporter();
    installImpersonationFetchGuard();
  }, []);

  const tree = (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange>
    <RegionProvider>
      <LanguageRegionProvider>
        <TooltipProvider>
          <PerfInstrumentation />
          <Suspense fallback={null}>
            <PointerLockWatchdog />
            <RuntimeAuditPanel />
          </Suspense>
          <DegradedModeBanner />
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <HeadSync />
            <CookieConsentBanner />
            <AuthProvider>
              <TenantQueryInvalidator />
              <BranchProvider>
                <SuperAdminProvider>
                  <LicenseProvider>
                    <KioskUnlockListener />
                    <AnimatedRoutes />
                  </LicenseProvider>
                </SuperAdminProvider>
              </BranchProvider>
            </AuthProvider>
          </BrowserRouter>
        </TooltipProvider>
      </LanguageRegionProvider>
    </RegionProvider>
    </ThemeProvider>
  );

  // Persisted cache: dashboard aggregates survive remounts and reloads, so a
  // revisit paints instantly and only revalidates in the background.
  if (queryPersister) {
    return (
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{
          persister: queryPersister,
          maxAge: PERSIST_MAX_AGE,
          buster: PERSIST_BUSTER,
          dehydrateOptions: { shouldDehydrateQuery: isPersistableQuery },
        }}
      >
        {tree}
      </PersistQueryClientProvider>
    );
  }

  return <QueryClientProvider client={queryClient}>{tree}</QueryClientProvider>;
};

export default App;

