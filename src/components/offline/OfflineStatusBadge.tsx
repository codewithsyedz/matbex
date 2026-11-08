import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Cloud, CloudOff, RefreshCw, AlertTriangle, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import type { ConnectivityStatus } from "@/lib/offline/types";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const LS_KEY = "offline-badge:last-status:v1";
type Cached = { status: ConnectivityStatus; pending: number; failed: number };

function readCache(): Cached | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Cached;
    if (!parsed || typeof parsed.status !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(c: Cached) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(c));
  } catch {
    /* ignore quota/SSR */
  }
}

/**
 * Compact status pill for the top bar. Click to open the Sync Center.
 *
 * Performance: this component intentionally does NOT import the offline
 * stack at module load. It shows a cheap navigator.onLine-derived state
 * by default and only lazy-loads the full sync engine when:
 *   - the browser reports it has gone offline, OR
 *   - the offline layer has already been booted elsewhere (e.g. user
 *     visited /offline-sync), OR
 *   - the user hovers the badge (preparing to click into the center).
 */
export function OfflineStatusBadge({ className }: { className?: string }) {
  // Seed from localStorage so the top bar reflects the last known state
  // immediately on page load, before the sync engine hydrates. If the
  // browser is currently offline, prefer that over the cached value.
  const initial = (() => {
    const cached = typeof window !== "undefined" ? readCache() : null;
    const isOffline =
      typeof navigator !== "undefined" && navigator.onLine === false;
    if (isOffline) {
      return {
        status: "offline" as ConnectivityStatus,
        pending: cached?.pending ?? 0,
        failed: cached?.failed ?? 0,
      };
    }
    return {
      status: (cached?.status ?? "online") as ConnectivityStatus,
      pending: cached?.pending ?? 0,
      failed: cached?.failed ?? 0,
    };
  })();
  const [status, setStatus] = useState<ConnectivityStatus>(initial.status);
  const [pending, setPending] = useState(initial.pending);
  const [failed, setFailed] = useState(initial.failed);
  const [hydrated, setHydrated] = useState(false);
  // True from the moment we kick off the dynamic import until the engine
  // has emitted its first status. Keeps the badge visibly "alive" so the
  // top bar never feels stale on the first interaction.
  const [hydrating, setHydrating] = useState(false);
  // Timestamp of the last status emission from the engine. Drives the
  // "Updated 12s ago" line in the tooltip.
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  // Earliest scheduled retry across all queued items (ms epoch). null when
 // either there are no items, or the engine hasn't hydrated yet.
  const [nextRetryAt, setNextRetryAt] = useState<number | null>(null);
  // Re-render every second while the tooltip is open so countdowns update.
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!tooltipOpen) return;
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [tooltipOpen]);

  useEffect(() => {
    let cancelled = false;
    let unsub: (() => void) | null = null;

    const cheapOnline = () => setStatus("online");
    const cheapOffline = () => {
      setStatus("offline");
      // Going offline → boot the engine so we can queue work.
      void hydrate();
    };
    window.addEventListener("online", cheapOnline);
    window.addEventListener("offline", cheapOffline);

    async function hydrate() {
      if (hydrated || cancelled) return;
      setHydrated(true);
      setHydrating(true);
      const [{ subscribeSyncStatus }, { ensureOfflineBootstrapped }] = await Promise.all([
        import("@/lib/offline/syncEngine"),
        import("@/lib/offline/lazyBootstrap"),
      ]);
      // Only boot if it's already running OR we're offline. Otherwise
      // just subscribe - the engine no-ops until bootstrapOffline() runs.
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        await ensureOfflineBootstrapped(null);
      }
      if (cancelled) {
        setHydrating(false);
        return;
      }
      unsub = subscribeSyncStatus(({ status, pending, failed }) => {
        setStatus(status);
        setPending(pending);
        setFailed(failed);
        setLastUpdated(Date.now());
        writeCache({ status, pending, failed });
        // First status callback → engine is live, drop the spinner.
        setHydrating(false);
        // Refresh the next-retry hint opportunistically.
        void refreshNextRetry();
      });
    }

    async function refreshNextRetry() {
      try {
        const { getQueueSnapshot } = await import("@/lib/offline/syncEngine");
        const q = await getQueueSnapshot();
        let earliest: number | null = null;
        for (const item of q) {
          if (!item.next_retry_at) continue;
          const t = new Date(item.next_retry_at).getTime();
          if (Number.isFinite(t) && (earliest === null || t < earliest)) {
            earliest = t;
          }
        }
        if (!cancelled) setNextRetryAt(earliest);
      } catch {
        /* engine not booted yet - ignore */
      }
    }

    return () => {
      cancelled = true;
      window.removeEventListener("online", cheapOnline);
      window.removeEventListener("offline", cheapOffline);
      unsub?.();
    };
  }, [hydrated]);

  const onPrepare = () => {
    // Prefetch the Sync Center route chunk + its hot data deps so that
    // clicking the badge feels instant. Safe to fire repeatedly: dynamic
    // imports are cached by the bundler.
    void import("@/pages/OfflineSyncCenter");
    void import("@/lib/offline/syncEngine");
    void import("@/lib/offline/db");
    if (hydrated) return;
    setHydrating(true);
    void (async () => {
      const { ensureOfflineBootstrapped } = await import("@/lib/offline/lazyBootstrap");
      await ensureOfflineBootstrapped(null);
      // hydrate() effect will take over once the subscription fires;
      // keep the spinner up until then.
    })();
  };

  const map = {
    online: {
      label: "Online",
      icon: Cloud,
      variant: "secondary" as const,
      tone: "text-emerald-600",
    },
    offline: {
      label: "Offline",
      icon: CloudOff,
      variant: "outline" as const,
      tone: "text-amber-600",
    },
    syncing: {
      label: "Syncing",
      icon: RefreshCw,
      variant: "secondary" as const,
      tone: "text-blue-600",
    },
    "sync-failed": {
      label: "Sync failed",
      icon: AlertTriangle,
      variant: "destructive" as const,
      tone: "text-destructive-foreground",
    },
  };

  const { label, icon: Icon, variant, tone } = map[status];
  const queued = pending + failed;
  const showSpinner = hydrating;

  const updatedLabel = (() => {
    if (!lastUpdated) return "Not yet synced";
    const diff = Math.max(0, Math.round((Date.now() - lastUpdated) / 1000));
    if (diff < 5) return "Updated just now";
    if (diff < 60) return `Updated ${diff}s ago`;
    const m = Math.floor(diff / 60);
    if (m < 60) return `Updated ${m}m ago`;
    const h = Math.floor(m / 60);
    return `Updated ${h}h ago`;
  })();

  const nextRetryLabel = (() => {
    if (nextRetryAt === null) {
      return failed > 0 ? "No retry scheduled" : "-";
    }
    const ms = nextRetryAt - Date.now();
    if (ms <= 0) return "Retrying now…";
    const s = Math.ceil(ms / 1000);
    if (s < 60) return `in ${s}s`;
    const m = Math.floor(s / 60);
    const rem = s % 60;
    if (m < 60) return `in ${m}m ${rem}s`;
    const h = Math.floor(m / 60);
    return `in ${h}h ${m % 60}m`;
  })();

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip open={tooltipOpen} onOpenChange={setTooltipOpen}>
        <TooltipTrigger asChild>
          <Link
            to="/offline-sync"
            className={cn("inline-flex", className)}
            onMouseEnter={onPrepare}
            onFocus={onPrepare}
          >
            <Badge
              variant={variant}
              className={cn(
                "gap-1.5 font-normal cursor-pointer",
                (status === "syncing" || showSpinner) && "animate-pulse",
              )}
              aria-busy={showSpinner || undefined}
            >
              {showSpinner ? (
                <Loader2
                  className={cn("h-3.5 w-3.5 animate-spin text-muted-foreground")}
                  aria-label="Loading sync status"
                />
              ) : (
                <Icon className={cn("h-3.5 w-3.5", tone, status === "syncing" && "animate-spin")} />
              )}
              <span>{showSpinner ? "Checking…" : label}</span>
              {queued > 0 && (
                <span className="ml-1 inline-flex items-center justify-center rounded-full bg-background/60 px-1.5 text-[10px] font-medium">
                  {queued}
                </span>
              )}
            </Badge>
          </Link>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="end" className="text-xs">
          <div className="flex flex-col gap-1 min-w-[180px]">
            <div className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">Status</span>
              <span className="font-medium capitalize">{label}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">Pending</span>
              <span className="font-medium tabular-nums">{pending}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">Failed</span>
              <span
                className={cn(
                  "font-medium tabular-nums",
                  failed > 0 && "text-destructive",
                )}
              >
                {failed}
              </span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">Next retry</span>
              <span className="font-medium tabular-nums">{nextRetryLabel}</span>
            </div>
            <div className="mt-1 border-t border-border/50 pt-1 text-[10px] text-muted-foreground">
              {updatedLabel}
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}