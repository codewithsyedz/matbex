import { useEffect, useState } from "react";
import { subscribeSyncStatus, getLastSyncedAt, refreshSyncStatus } from "@/lib/offline/syncEngine";
import type { ConnectivityStatus } from "@/lib/offline/types";

export interface OfflineStatusSnapshot {
  status: ConnectivityStatus;
  pending: number;
  failed: number;
  lastSyncedAt: string | null;
}

export function useOfflineStatus(): OfflineStatusSnapshot {
  const [snap, setSnap] = useState<OfflineStatusSnapshot>({
    status: "online",
    pending: 0,
    failed: 0,
    lastSyncedAt: null,
  });

  useEffect(() => {
    const unsub = subscribeSyncStatus(({ status, pending, failed }) => {
      setSnap((s) => ({ ...s, status, pending, failed }));
    });
    let alive = true;
    void getLastSyncedAt().then((ts) => {
      if (alive) setSnap((s) => ({ ...s, lastSyncedAt: ts }));
    });
    const id = window.setInterval(async () => {
      const ts = await getLastSyncedAt();
      if (alive) setSnap((s) => ({ ...s, lastSyncedAt: ts }));
    }, 15_000);
    // Service Worker drained the queue while the tab was idle/closed.
    const onDrained = () => {
      void refreshSyncStatus();
      void getLastSyncedAt().then((ts) => {
        if (alive) setSnap((s) => ({ ...s, lastSyncedAt: ts }));
      });
    };
    window.addEventListener("pos-sync-drained", onDrained);
    return () => {
      alive = false;
      unsub();
      window.clearInterval(id);
      window.removeEventListener("pos-sync-drained", onDrained);
    };
  }, []);

  return snap;
}