import { useRef, useState, type ReactNode } from "react";
import { RefreshCw, ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";

const THRESHOLD = 70;
const MAX_PULL = 110;

interface PullToRefreshProps {
  onRefresh: () => Promise<void> | void;
  refreshing?: boolean;
  children: ReactNode;
  className?: string;
}

/**
 * Touch pull-to-refresh wrapper for POS scroll regions.
 * Only engages when the inner scroll container is already at the top,
 * so normal scrolling is never blocked.
 */
export function PullToRefresh({ onRefresh, refreshing = false, children, className }: PullToRefreshProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const startY = useRef<number | null>(null);
  const [pull, setPull] = useState(0);

  const scroller = () => {
    const host = hostRef.current;
    if (!host) return null;
    return (
      host.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]") ?? host
    );
  };

  const onTouchStart = (e: React.TouchEvent) => {
    if (refreshing) return;
    const el = scroller();
    if (!el || el.scrollTop > 0) return;
    startY.current = e.touches[0].clientY;
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (startY.current === null) return;
    const el = scroller();
    if (el && el.scrollTop > 0) {
      startY.current = null;
      setPull(0);
      return;
    }
    const delta = e.touches[0].clientY - startY.current;
    if (delta <= 0) {
      setPull(0);
      return;
    }
    // Rubber-band resistance
    setPull(Math.min(MAX_PULL, delta * 0.5));
  };

  const onTouchEnd = async () => {
    const distance = pull;
    startY.current = null;
    setPull(0);
    if (distance >= THRESHOLD && !refreshing) {
      await onRefresh();
    }
  };

  const active = pull > 0 || refreshing;
  const ready = pull >= THRESHOLD;

  return (
    <div
      ref={hostRef}
      className={cn("relative flex-1 min-h-0 flex flex-col", className)}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
    >
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-center transition-opacity",
          active ? "opacity-100" : "opacity-0",
        )}
        style={{ height: refreshing ? 44 : Math.max(pull, 0) }}
        aria-hidden={!active}
      >
        <div className="flex items-center gap-2 rounded-full border bg-background/90 px-3 py-1.5 text-xs font-medium shadow-sm backdrop-blur">
          {refreshing ? (
            <>
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              Refreshing…
            </>
          ) : (
            <>
              <ArrowDown
                className={cn("h-3.5 w-3.5 transition-transform", ready && "rotate-180")}
              />
              {ready ? "Release to refresh" : "Pull to refresh"}
            </>
          )}
        </div>
      </div>
      <div
        className="flex-1 min-h-0 flex flex-col transition-transform"
        style={{ transform: `translateY(${refreshing ? 44 : pull}px)` }}
      >
        {children}
      </div>
    </div>
  );
}

export default PullToRefresh;
