import { ReactNode } from "react";
import { AdminSidebar } from "./AdminSidebar";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { motion } from "framer-motion";
import { LanguageSelector } from "@/components/landing/LanguageSelector";
import { RegionSelector } from "@/components/landing/RegionSelector";

interface AdminLayoutProps {
  children: ReactNode;
}

const contentVariants = {
  initial: { opacity: 0, y: 8 },
  animate: { 
    opacity: 1, 
    y: 0,
    transition: { duration: 0.25, ease: [0.22, 1, 0.36, 1] }
  },
};

export function AdminLayout({ children }: AdminLayoutProps) {
  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background">
        <AdminSidebar />
        <SidebarInset className="flex-1 flex flex-col">
          {/* Admin Header with Language/Region Selectors */}
          <header className="h-14 px-6 lg:px-8 border-b border-border flex items-center justify-end gap-2">
            <LanguageSelector />
            <RegionSelector />
          </header>
          
          <div className="flex-1 p-6 lg:p-8">
            <motion.div 
              variants={contentVariants}
              initial="initial"
              animate="animate"
              className="w-full max-w-6xl"
            >
              {children}
            </motion.div>
          </div>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
