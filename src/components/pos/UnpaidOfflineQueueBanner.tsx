import { useEffect, useState } from "react";
import { CheckCircle2, CloudOff, Loader2, AlertTriangle } from "lucide-react";
import {
  subscribeSyncStatus,
  refreshSyncStatus,
} from "@/lib/offline/syncEngine";
import type { ConnectivityStatus } from "@/lib/offline/types";

interface Props {
  /** Last receipt number queued offline in *this* tab, if any. */
  lastQueuedReceipt?: string | null;
}

/**
 * Compact status banner shown alongside the unpaid (customer-tab) flow so
 * cashiers can tell at a glance whether their last unpaid entry is still
 * sitting in the local IndexedDB queue or has been confirmed by the server.
 */
export function UnpaidOfflineQueueBanner({ lastQueuedReceipt }: Props) {
  const [snap, setSnap] = useState<{
    status: ConnectivityStatus;
    pending: number;
    failed: number;
  }>({ status: "online", pending: 0, failed: 0 });

  useEffect(() => {
    const unsub = subscribeSyncStatus((s) => setSnap(s));
    // Force a refresh on mount so the badge isn't stale.
    void refreshSyncStatus();
    // Light poll fallback in case the engine misses an event (e.g. SW drain).
    const id = window.setInterval(() => {
      void refreshSyncStatus();
    }, 5000);
    return () => {
      unsub();
      window.clearInterval(id);
    };
  }, []);

  const { status, pending, failed } = snap;

  // Pick a single, unambiguous state for the cashier.
  let tone: "ok" | "syncing" | "offline" | "error";
  let Icon = CheckCircle2;
  let title = "All unpaid sales synced to server";
  let detail: string | null = null;

  if (failed > 0) {
    tone = "error";
    Icon = AlertTriangle;
    title = `${failed} item${failed === 1 ? "" : "s"} failed to sync`;
    detail = "Open Sync Center to retry. Until then, these entries live only on this device.";
  } else if (status === "offline" && pending > 0) {
    tone = "offline";
    Icon = CloudOff;
    title = `Offline · ${pending} item${pending === 1 ? "" : "s"} queued locally`;
    detail = "Stored on this device. Will sync automatically when back online.";
  } else if (pending > 0) {
    tone = "syncing";
    Icon = Loader2;
    title = `Syncing ${pending} item${pending === 1 ? "" : "s"} to server…`;
    detail = "Keep this tab open until the count reaches zero.";
  } else if (status === "offline") {
    tone = "offline";
    Icon = CloudOff;
    title = "Offline";
    detail = "Unpaid sales will be queued locally until connectivity returns.";
  } else {
    tone = "ok";
    Icon = CheckCircle2;
    title = "All unpaid sales synced to server";
    detail = lastQueuedReceipt
      ? `Last queued receipt ${lastQueuedReceipt} confirmed.`
      : null;
  }

  const toneClasses: Record<typeof tone, string> = {
    ok: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    syncing: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
    offline: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    error: "border-destructive/40 bg-destructive/10 text-destructive",
  };

  return (
    <div
      className={`mt-2 flex items-start gap-2 rounded-md border px-3 py-2 text-xs ${toneClasses[tone]}`}
      role="status"
      aria-live="polite"
    >
      <Icon
        className={`h-4 w-4 mt-0.5 shrink-0 ${tone === "syncing" ? "animate-spin" : ""}`}
      />
      <div className="space-y-0.5">
        <p className="font-medium leading-tight">{title}</p>
        {detail && <p className="opacity-80 leading-snug">{detail}</p>}
        {lastQueuedReceipt && tone !== "ok" && (
          <p className="opacity-80 leading-snug">
            Last queued receipt: <span className="font-mono">{lastQueuedReceipt}</span>
          </p>
        )}
      </div>
    </div>
  );
}