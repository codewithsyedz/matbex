import { useEffect, useRef, useState } from "react";
import { X, Eye, Minimize2, Maximize2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useRoleGuard } from "@/hooks/useRoleGuard";
import { TodayTickerBadges } from "./TodayTickerBadges";
import { formatZonedYMD } from "@/lib/timezone";
import {
  motion,
  useMotionValue,
  useTransform,
  type PanInfo,
} from "framer-motion";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "matbex:today-ticker-dismissed";
const COMPACT_KEY = "matbex:today-ticker-compact";

/**
 * Shared spacing token for the floating ticker. Combines the bottom
 * safe-area inset (notch/home-indicator on iOS, gesture bar on Android)
 * with a consistent 1rem visual gutter so the compact restore button
 * and the expanded badge row snap to the exact same baseline.
 */
const OVERLAY_BOTTOM_OFFSET = "calc(env(safe-area-inset-bottom, 0px) + 1rem)";
const OVERLAY_INSET_LEFT = "env(safe-area-inset-left, 0px)";
const OVERLAY_INSET_RIGHT = "env(safe-area-inset-right, 0px)";
/**
 * Extra cushion added below the safe-area inset for the footer-style
 * overlay. iOS reports the home-indicator inset (~34px) via
 * `safe-area-inset-bottom`, but the indicator itself sits centered
 * inside that band and can visually clip ticker content during the
 * slide-in. Adding 0.5rem of additional padding guarantees clearance
 * on devices with a home indicator and is a no-op on devices without
 * one (where the inset resolves to 0px).
 */
const OVERLAY_FOOTER_BOTTOM_PADDING =
  "calc(env(safe-area-inset-bottom, 0px) + 0.5rem)";

/** Returns the current restaurant-local date as YYYY-MM-DD. */
function getTodayKey(timezone: string): string {
  return formatZonedYMD(new Date(), timezone);
}

function isDismissedToday(timezone: string): boolean {
  try {
    return sessionStorage.getItem(STORAGE_KEY) === getTodayKey(timezone);
  } catch {
    return false;
  }
}

/**
 * Global floating overlay showing today's key metrics (sales, expenses,
 * transactions). Rendered once at the app shell level so it persists
 * across all authenticated routes.
 */
export function TodayTickerOverlay() {
  const { restaurant } = useAuth();
  const timezone = restaurant?.timezone || "Asia/Riyadh";
  const [dismissed, setDismissed] = useState<boolean>(() => isDismissedToday(timezone));
  const [compact, setCompact] = useState<boolean>(() => {
    try {
      const stored = sessionStorage.getItem(COMPACT_KEY);
      if (stored !== null) return stored === "1";
      // Default to compact on narrow viewports so labels don't crowd mobile screens.
      return window.matchMedia("(max-width: 640px)").matches;
    } catch {
      return false;
    }
  });

  const toggleCompact = () => {
    setCompact((prev) => {
      const next = !prev;
      try {
        sessionStorage.setItem(COMPACT_KEY, next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  };

  // Re-check on mount in case the restaurant timezone resolved late, and
  // periodically so the overlay reappears automatically when the
  // restaurant day rolls over.
  useEffect(() => {
    setDismissed(isDismissedToday(timezone));
    const id = window.setInterval(() => {
      if (isDismissedToday(timezone)) return;
      setDismissed(false);
    }, 60 * 1000);
    return () => window.clearInterval(id);
  }, [timezone]);

  // Auto-switch to compact when the viewport shrinks to mobile, but respect an
  // explicit user toggle on expansion.
  useEffect(() => {
    const mql = window.matchMedia("(max-width: 640px)");
    const handleChange = (e: MediaQueryListEvent) => {
      if (e.matches) setCompact(true);
    };
    mql.addEventListener("change", handleChange);
    return () => mql.removeEventListener("change", handleChange);
  }, []);

  if (!restaurant) return null;

  const { isCashierOnly } = useRoleGuard();
  if (isCashierOnly) return null;

  const handleDismiss = () => {
    try {
      sessionStorage.setItem(STORAGE_KEY, getTodayKey(timezone));
    } catch {
      // sessionStorage may be unavailable - fall back to in-memory only.
    }
    setDismissed(true);
  };

  const handleRestore = () => {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    setDismissed(false);
  };

  if (dismissed) {
    return (
      <button
        type="button"
        onClick={handleRestore}
        aria-label="Show today's metrics ticker"
        style={{
          bottom: OVERLAY_BOTTOM_OFFSET,
          marginLeft: OVERLAY_INSET_LEFT,
          marginRight: OVERLAY_INSET_RIGHT,
          WebkitTapHighlightColor: "transparent",
          touchAction: "manipulation",
        }}
        className="fixed left-1/2 -translate-x-1/2 z-40 h-11 min-w-[44px] px-3.5 gap-1.5 rounded-full bg-background/95 backdrop-blur-xl border border-border/60 shadow-lg flex items-center justify-center text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-background hover:border-primary/40 active:scale-95 transition-all duration-200 animate-in fade-in slide-in-from-bottom-2 before:content-[''] before:absolute before:-inset-2 before:rounded-full"
      >
        <Eye className="h-4 w-4 text-primary" aria-hidden />
        <span className="hidden sm:inline">Today</span>
      </button>
    );
  }

  return (
    <DraggableOverlay
      onDismiss={handleDismiss}
      compact={compact}
      toggleCompact={toggleCompact}
    />
  );
}

const DISMISS_THRESHOLD = 60;
const DISMISS_VELOCITY = 500;

/** Triggers a soft haptic pulse on supported devices (Android Chrome, etc.). */
function vibrate(pattern: number | number[]) {
  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      (navigator as Navigator).vibrate(pattern);
    }
  } catch {
    // ignore - vibration is a progressive enhancement only.
  }
}

interface DraggableOverlayProps {
  onDismiss: () => void;
  compact: boolean;
  toggleCompact: () => void;
}

function DraggableOverlay({ onDismiss, compact, toggleCompact }: DraggableOverlayProps) {
  const y = useMotionValue(0);
  // Visually fade and shrink the overlay slightly as the user drags it down,
  // mirroring the "pull-to-dismiss" affordance found in native iOS sheets.
  const opacity = useTransform(y, [0, 160], [1, 0.6]);
  const handleScale = useTransform(y, [0, DISMISS_THRESHOLD], [1, 1.4]);
  const [armed, setArmed] = useState(false);
  const armedRef = useRef(false);

  // Watch motion value so we can fire a single haptic pulse when the user
  // crosses the dismiss threshold (and another when they retreat back).
  useEffect(() => {
    const unsub = y.on("change", (latest) => {
      const past = latest > DISMISS_THRESHOLD;
      if (past && !armedRef.current) {
        armedRef.current = true;
        setArmed(true);
        vibrate(8);
      } else if (!past && armedRef.current) {
        armedRef.current = false;
        setArmed(false);
      }
    });
    return () => unsub();
  }, [y]);

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    const distance = info.offset.y;
    const velocity = info.velocity.y;
    if (distance > DISMISS_THRESHOLD || velocity > DISMISS_VELOCITY) {
      vibrate([10, 30, 10]);
      onDismiss();
      return;
    }
    // Snap-back: framer-motion will spring `y` back to 0 because we use
    // `dragSnapToOrigin`. Reset the armed state so the next gesture is fresh.
    armedRef.current = false;
    setArmed(false);
  };

  return (
    <motion.div
      className="fixed inset-x-0 bottom-0 z-40 pointer-events-none"
      style={{
        paddingLeft: OVERLAY_INSET_LEFT,
        paddingRight: OVERLAY_INSET_RIGHT,
        paddingBottom: OVERLAY_FOOTER_BOTTOM_PADDING,
        y,
        opacity,
      }}
      role="status"
      aria-label="Today's key metrics. Swipe down to dismiss."
      initial={{ y: 80, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 80, opacity: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      drag="y"
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={{ top: 0, bottom: 0.5 }}
      dragMomentum={false}
      dragSnapToOrigin
      dragTransition={{
        bounceStiffness: 420,
        bounceDamping: 32,
      }}
      onDragEnd={handleDragEnd}
    >
      <div
        className={cn(
          "pointer-events-auto mx-auto w-full max-w-3xl border-t bg-background/90 backdrop-blur-xl shadow-[0_-4px_20px_-8px_hsl(var(--foreground)/0.12)] select-none transition-colors duration-200",
          armed ? "border-primary/50" : "border-border/60",
        )}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-1.5 pb-1">
          <motion.div
            style={{ scaleX: handleScale }}
            className={cn(
              "h-1 w-10 rounded-full transition-colors duration-200",
              armed ? "bg-primary/70" : "bg-muted-foreground/30",
            )}
          />
        </div>
        <div className="flex items-center justify-between gap-2 px-3 pb-2">
          <div className="flex-1 min-w-0 overflow-x-auto scrollbar-none">
            <TodayTickerBadges compact={compact} />
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={toggleCompact}
              onPointerDown={(e) => e.stopPropagation()}
              aria-label={compact ? "Expand ticker labels" : "Compact ticker"}
              aria-pressed={compact}
              title={compact ? "Show labels" : "Compact mode"}
              className="h-8 w-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
            >
              {compact ? <Maximize2 className="h-4 w-4" /> : <Minimize2 className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={onDismiss}
              onPointerDown={(e) => e.stopPropagation()}
              aria-label="Dismiss today's metrics ticker"
              className="h-8 w-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}