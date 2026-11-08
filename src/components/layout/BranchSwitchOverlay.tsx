import { AnimatePresence, motion } from "framer-motion";
import { useBranch } from "@/contexts/BranchContext";
import { Loader2 } from "lucide-react";

/**
 * Lightweight skeleton shown briefly while the active branch changes.
 * Sits inside <main> so the sidebar/header remain interactive.
 */
export function BranchSwitchOverlay() {
  const { isSwitchingBranch, activeBranch, isAllBranches } = useBranch();
  const label = isAllBranches
    ? "All branches"
    : activeBranch?.name ?? "branch";

  return (
    <AnimatePresence>
      {isSwitchingBranch && (
        <motion.div
          key="branch-switch-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="absolute inset-0 z-20 grid place-items-center bg-background/70 backdrop-blur-sm pointer-events-none"
          aria-live="polite"
          aria-busy="true"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.2 }}
            className="flex flex-col items-center gap-3 rounded-2xl border border-border/50 bg-card/90 px-8 py-6 shadow-lg"
          >
            <span className="relative flex h-10 w-10 items-center justify-center">
              <span className="absolute inset-0 rounded-full bg-primary/10 animate-ping" />
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </span>
            <div className="text-center">
              <p className="text-sm font-medium">Switching branch</p>
              <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}