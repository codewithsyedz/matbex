import { ReactNode, useMemo } from "react";
import { useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { AdminSidebar, adminNavGroups } from "./AdminSidebar";
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { LanguageSelector } from "@/components/landing/LanguageSelector";
import { RegionSelector } from "@/components/landing/RegionSelector";
import { ThemeToggle } from "@/components/layout/ThemeToggle";

interface AdminLayoutProps {
  children: ReactNode;
}

const contentVariants = {
  initial: { opacity: 0, y: 8 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.25, ease: [0.22, 1, 0.36, 1] },
  },
};

/** Section › page for the header, from the side menu (a business's page shows under Tenants). */
function useAdminCrumb() {
  const { pathname } = useLocation();
  return useMemo(() => {
    for (const g of adminNavGroups) {
      const item = g.items.find((i) => i.path === pathname);
      if (item) return { section: g.label === item.title ? null : g.label, page: item.title };
    }
    if (pathname.startsWith("/admin/tenants/")) return { section: "Tenants", page: "Business details" };
    return { section: null, page: "SuperAdmin" };
  }, [pathname]);
}

export function AdminLayout({ children }: AdminLayoutProps) {
  const crumb = useAdminCrumb();
  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background">
        <AdminSidebar />
        {/* min-w-0 lets wide tables scroll inside their card instead of widening the page. */}
        <SidebarInset className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b border-border/60 bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:px-6">
            <SidebarTrigger className="-ms-1 h-9 w-9" aria-label="Toggle menu" />
            <Separator orientation="vertical" className="mx-1 h-5" />
            <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
              {crumb.section && (
                <>
                  <span className="hidden truncate text-muted-foreground sm:inline">{crumb.section}</span>
                  <span className="hidden text-muted-foreground/60 sm:inline">/</span>
                </>
              )}
              <span className="truncate font-medium text-foreground">{crumb.page}</span>
            </nav>
            <div className="ms-auto flex shrink-0 items-center gap-1">
              <div className="hidden items-center gap-1 sm:flex">
                <LanguageSelector />
                <RegionSelector />
              </div>
              <ThemeToggle />
            </div>
          </header>

          <main className="min-w-0 flex-1 px-4 py-5 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
            <motion.div
              variants={contentVariants}
              initial="initial"
              animate="animate"
              className="admin-page mx-auto w-full min-w-0 max-w-7xl"
            >
              {children}
            </motion.div>
          </main>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
