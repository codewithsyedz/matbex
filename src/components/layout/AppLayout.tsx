import { useState, useEffect, useCallback } from "react";
import { useLocation } from "react-router-dom";
import { AppSidebar } from "./AppSidebar";
import { AppHeader } from "./AppHeader";
import { PageBreadcrumbs } from "./PageBreadcrumbs";
import { NotificationReturnBanner } from "@/components/notifications/NotificationReturnBanner";
import { CommandPalette } from "./CommandPalette";
import { TrialBanner } from "./TrialBanner";
import { BranchSwitchOverlay } from "./BranchSwitchOverlay";
import { ImpersonationBanner } from "@/components/admin/ImpersonationBanner";
import { RoleImpersonationBanner } from "@/components/auth/RoleImpersonationBanner";
import { FloatingChat } from "@/components/chat/FloatingChat";
import { TodayTickerOverlay } from "@/components/dashboard/TodayTickerOverlay";
import { PwaInstallPrompt } from "@/components/pwa/PwaInstallPrompt";
import { useIsMobile } from "@/hooks/use-mobile";
import { motion } from "framer-motion";
import { usePrefetchRoute } from "@/hooks/usePrefetchRoute";

interface AppLayoutProps {
  children: React.ReactNode;
}

const contentVariants = {
  initial: { opacity: 1, y: 0 },
  animate: { 
    opacity: 1, 
    y: 0,
    transition: { duration: 0 }
  },
  exit: { 
    opacity: 1, 
    y: 0,
    transition: { duration: 0 }
  },
};

export function AppLayout({ children }: AppLayoutProps) {
  const [commandOpen, setCommandOpen] = useState(false);
  const isMobile = useIsMobile();
  const location = useLocation();
  const prefetchRoute = usePrefetchRoute();

  // Stable identity so the memoized AppSidebar never re-renders (or remounts)
  // just because the layout re-rendered on a route change.
  const openCommandPalette = useCallback(() => setCommandOpen(true), []);

  // When the active route settles (and isn't already the dashboard),
  // warm the dashboard cache in the background so the next nav is instant.
  useEffect(() => {
    if (location.pathname === "/dashboard") return;
    const idle = (cb: () => void) =>
      typeof (window as any).requestIdleCallback === "function"
        ? (window as any).requestIdleCallback(cb, { timeout: 1500 })
        : window.setTimeout(cb, 600);
    const cancel = (id: any) =>
      typeof (window as any).cancelIdleCallback === "function"
        ? (window as any).cancelIdleCallback(id)
        : clearTimeout(id);
    const id = idle(() => prefetchRoute("/dashboard"));
    return () => cancel(id);
  }, [location.pathname, prefetchRoute]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setCommandOpen((open) => !open);
      }
    };

    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  return (
    <div className="app-workspace flex h-dvh w-full bg-background overflow-hidden">
      <AppSidebar onOpenCommandPalette={openCommandPalette} />
      <div className="flex-1 flex flex-col h-dvh overflow-hidden">
        <ImpersonationBanner />
        <RoleImpersonationBanner />
        <TrialBanner />
        <AppHeader />
        <motion.main
          variants={contentVariants}
          initial="initial"
          animate="animate"
          className={`relative flex-1 overflow-y-auto pb-20 md:pb-12 ${isMobile ? 'pt-14' : ''}`}
        >
          <NotificationReturnBanner />
          <PageBreadcrumbs />
          {children}
          <BranchSwitchOverlay />
        </motion.main>
      </div>
      <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} />
      <FloatingChat />
      <TodayTickerOverlay />
      <PwaInstallPrompt />
    </div>
  );
}
