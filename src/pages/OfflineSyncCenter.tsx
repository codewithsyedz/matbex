import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useOfflineStatus } from "@/hooks/useOfflineStatus";
import {
  getQueueSnapshot,
  retryAllFailed,
  retryQueueItem,
  forceRetryQueueItem,
  runSync,
} from "@/lib/offline/syncEngine";
import { getAll, STORES } from "@/lib/offline/db";
import { getTerminalId } from "@/lib/offline/terminal";
import { requestBackgroundSync } from "@/lib/offline/backgroundSync";
import { ensureOfflineBootstrapped } from "@/lib/offline/lazyBootstrap";
import { useAuth } from "@/contexts/AuthContext";
import type { OfflineRecord, SyncQueueItem } from "@/lib/offline/types";
import { Download, RefreshCw, PlayCircle, FileText, Zap, Timer } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { buildReceiptPdfFromLocalId, downloadBlob } from "@/lib/offline/receiptPdf";
import { categorizeQueueError, SEVERITY_BADGE_VARIANT } from "@/lib/offline/errorCategorization";
import { formatCountdown, getRetryPolicy } from "@/lib/offline/retryPolicy";

/**
 * Admin-facing Offline Sync Center.
 * Lists pending + failed items, allows manual retry / force sync / JSON export.
 */
export default function OfflineSyncCenter() {
  const status = useOfflineStatus();
  const { user, restaurant, hasRole } = useAuth();
  const isAdmin = hasRole("owner") || hasRole("manager");
  const [queue, setQueue] = useState<SyncQueueItem[]>([]);
  const [records, setRecords] = useState<Record<string, OfflineRecord>>({});
  const [orders, setOrders] = useState<OfflineRecord[]>([]);
  const [terminalId, setTerminalId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Tick every second so countdowns update live.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const refresh = async () => {
    const q = await getQueueSnapshot();
    setQueue(q);
    const ordersAll = await getAll<OfflineRecord>(STORES.orders);
    setOrders(
      [...ordersAll].sort((a, b) =>
        (b.created_at || "").localeCompare(a.created_at || ""),
      ),
    );
    const all: OfflineRecord[] = [
      ...ordersAll,
      ...(await getAll<OfflineRecord>(STORES.payments)),
      ...(await getAll<OfflineRecord>(STORES.invoices)),
      ...(await getAll<OfflineRecord>(STORES.cashDrawer)),
    ];
    const idx: Record<string, OfflineRecord> = {};
    for (const r of all) idx[r.local_id] = r;
    setRecords(idx);
  };

  useEffect(() => {
    // Opening the Sync Center is an explicit signal the user wants
    // offline mode - boot the engine now if it hasn't started yet.
    void ensureOfflineBootstrapped(restaurant?.id ?? null);
    void refresh();
    void getTerminalId().then(setTerminalId);
    const id = window.setInterval(refresh, 5000);
    return () => window.clearInterval(id);
  }, [status.pending, status.failed, status.status, restaurant?.id]);

  const failed = useMemo(
    () => queue.filter((q) => q.status === "FAILED" || q.status === "FAILED_VALIDATION"),
    [queue],
  );
  const pending = useMemo(
    () => queue.filter((q) => q.status === "PENDING" || q.status === "SYNCING"),
    [queue],
  );

  const handleForceSync = async () => {
    if (!restaurant?.id) return;
    setBusy(true);
    try {
      const tid = terminalId ?? (await getTerminalId());
      await runSync({ branchId: restaurant.id, terminalId: tid });
      // Also nudge the Service Worker so a background pass runs even if
      // the user navigates away from this tab.
      void requestBackgroundSync();
      await refresh();
      toast({ title: "Sync triggered" });
    } finally {
      setBusy(false);
    }
  };

  const handleRetryAll = async () => {
    setBusy(true);
    await retryAllFailed();
    if (restaurant?.id) {
      const tid = terminalId ?? (await getTerminalId());
      await runSync({ branchId: restaurant.id, terminalId: tid });
    }
    await refresh();
    setBusy(false);
    toast({ title: "Retrying all failed items" });
  };

  const handleExportBackup = async () => {
    const dump = {
      exported_at: new Date().toISOString(),
      terminal_id: terminalId,
      orders: await getAll(STORES.orders),
      payments: await getAll(STORES.payments),
      invoices: await getAll(STORES.invoices),
      cash_drawer: await getAll(STORES.cashDrawer),
      queue: await getAll(STORES.queue),
      failed: await getAll(STORES.failed),
    };
    const blob = new Blob([JSON.stringify(dump, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pos-offline-backup-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportItem = (qi: SyncQueueItem) => {
    const rec = records[qi.entity_local_id];
    const blob = new Blob([JSON.stringify({ queue: qi, record: rec }, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pos-failed-${qi.entity_type}-${qi.entity_local_id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadReceipt = async (orderLocalId: string) => {
    const result = await buildReceiptPdfFromLocalId({
      orderLocalId,
      restaurantName: restaurant?.name ?? "Receipt",
      cashierName: user?.email ?? null,
      currency: restaurant?.currency ?? "﷼",
    });
    if (!result) {
      toast({ title: "Receipt unavailable", description: "Order not found in local storage." });
      return;
    }
    downloadBlob(result.blob, result.filename);
  };

  return (
    <>
      <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-4 min-h-[56px]">
          <div className="min-w-[240px] flex-1"><h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight">Offline Sync Center</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Monitor and recover offline POS transactions for this device.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleExportBackup}>
              <Download className="h-4 w-4" /> Export backup
            </Button>
            <Button variant="outline" size="sm" onClick={handleRetryAll} disabled={busy || failed.length === 0}>
              <RefreshCw className="h-4 w-4" /> Retry all
            </Button>
            <Button size="sm" onClick={handleForceSync} disabled={busy}>
              <PlayCircle className="h-4 w-4" /> Force sync
            </Button>
          </div>
        </header>

        <div className="grid gap-4 md:grid-cols-4">
          <StatCard title="Status" value={status.status.toUpperCase()} />
          <StatCard title="Pending" value={pending.length} />
          <StatCard title="Failed" value={failed.length} tone={failed.length ? "destructive" : "muted"} />
          <StatCard
            title="Last successful sync"
            value={status.lastSyncedAt ? new Date(status.lastSyncedAt).toLocaleString() : "Never"}
          />
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium">Queue ({queue.length})</CardTitle>
            <CardDescription>
              Terminal {terminalId?.slice(0, 8) ?? "-"}.{" "}
              {isAdmin ? "Owner/manager view." : "Showing local device queue only."}
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[480px]">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-background border-b">
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="px-4 py-2">Entity</th>
                    <th className="px-4 py-2">Status</th>
                    <th className="px-4 py-2">Reference</th>
                    <th className="px-4 py-2">Retries</th>
                    <th className="px-4 py-2">Category &amp; next retry</th>
                    <th className="px-4 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {queue.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                        No offline items waiting to sync. ✨
                      </td>
                    </tr>
                  )}
                  {queue.map((qi) => {
                    const rec = records[qi.entity_local_id];
                    const ref =
                      (rec?.payload as any)?.receipt_number ||
                      qi.entity_local_id.slice(0, 8);
                    const cat = categorizeQueueError(qi);
                    const policy = getRetryPolicy(cat.id);
                    const nextMs = qi.next_retry_at
                      ? new Date(qi.next_retry_at).getTime() - now
                      : 0;
                    const isScheduled = !!qi.next_retry_at && nextMs > 0 && cat.retryable;
                    return (
                      <tr key={qi.queue_id} className="border-b hover:bg-muted/40">
                        <td className="px-4 py-2 font-mono text-xs">{qi.entity_type}</td>
                        <td className="px-4 py-2">
                          <Badge
                            variant={
                              qi.status === "FAILED" || qi.status === "FAILED_VALIDATION"
                                ? "destructive"
                                : qi.status === "SYNCING"
                                ? "secondary"
                                : "outline"
                            }
                          >
                            {qi.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-2 font-mono text-xs">{String(ref)}</td>
                        <td className="px-4 py-2 text-xs">
                          {qi.retry_count}
                          {policy.maxRetries > 0 && (
                            <span className="text-muted-foreground"> / {policy.maxRetries}</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-xs max-w-[280px]">
                          <div className="flex items-center gap-2 mb-1">
                            <Badge variant={SEVERITY_BADGE_VARIANT[cat.severity]}>{cat.label}</Badge>
                            {isScheduled && (
                              <span
                                className="inline-flex items-center gap-1 text-muted-foreground tabular-nums"
                                title={`Auto-retry at ${new Date(qi.next_retry_at!).toLocaleTimeString()}`}
                              >
                                <Timer className="h-3 w-3" />
                                {formatCountdown(nextMs)}
                              </span>
                            )}
                          </div>
                          <div className="text-muted-foreground truncate">{cat.suggestion}</div>
                        </td>
                        <td className="px-4 py-2 text-right space-x-2">
                          {qi.entity_type === "ORDER" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleDownloadReceipt(qi.entity_local_id)}
                              title="Download offline receipt PDF"
                            >
                              <FileText className="h-4 w-4" /> PDF
                            </Button>
                          )}
                          {isScheduled && (
                            <Button
                              size="sm"
                              variant="ghost"
                              title="Skip the backoff window and retry this item now"
                              onClick={async () => {
                                await forceRetryQueueItem(qi.queue_id);
                                if (restaurant?.id) {
                                  const tid = terminalId ?? (await getTerminalId());
                                  await runSync({ branchId: restaurant.id, terminalId: tid });
                                }
                                await refresh();
                                toast({ title: "Retrying now" });
                              }}
                            >
                              <Zap className="h-4 w-4" /> Now
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={async () => {
                              await retryQueueItem(qi.queue_id);
                              if (restaurant?.id) {
                                const tid = terminalId ?? (await getTerminalId());
                                await runSync({ branchId: restaurant.id, terminalId: tid });
                              }
                              await refresh();
                            }}
                          >
                            Retry
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => handleExportItem(qi)}>
                            JSON
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </ScrollArea>
          </CardContent>
        </Card>

        <Separator />
        <p className="text-xs text-muted-foreground">
          Card data is never stored locally. Customer phone, email and notes are encrypted with a
          per-device AES-GCM key that never leaves this browser.
        </p>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium">Offline receipts ({orders.length})</CardTitle>
            <CardDescription>
              Re-download a thermal-style PDF receipt for any order stored on this device - synced or not.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[360px]">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-background border-b">
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="px-4 py-2">Receipt #</th>
                    <th className="px-4 py-2">Date</th>
                    <th className="px-4 py-2">Total</th>
                    <th className="px-4 py-2">Status</th>
                    <th className="px-4 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-12 text-center text-muted-foreground">
                        No offline orders on this device yet.
                      </td>
                    </tr>
                  )}
                  {orders.map((o) => {
                    const p = (o.payload as any) ?? {};
                    const synced = o.status === "SYNCED";
                    return (
                      <tr key={o.local_id} className="border-b hover:bg-muted/40">
                        <td className="px-4 py-2 font-mono text-xs">
                          {p.receipt_number ?? o.local_id.slice(0, 8)}
                        </td>
                        <td className="px-4 py-2 text-xs">
                          {new Date(p.created_at ?? o.created_at).toLocaleString()}
                        </td>
                        <td className="px-4 py-2 text-xs">
                          {Number(p.total ?? 0).toFixed(2)}
                        </td>
                        <td className="px-4 py-2">
                          <Badge variant={synced ? "outline" : "secondary"}>
                            {synced ? "Synced" : "Provisional"}
                          </Badge>
                        </td>
                        <td className="px-4 py-2 text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleDownloadReceipt(o.local_id)}
                          >
                            <FileText className="h-4 w-4" /> Download
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </ScrollArea>
          </CardContent>
        </Card>

        {!user && <p className="text-xs text-amber-600">Sign in required to push to the server.</p>}
      </div>
    </>
  );
}

function StatCard({
  title,
  value,
  tone = "muted",
}: {
  title: string;
  value: string | number;
  tone?: "muted" | "destructive";
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardDescription className="text-xs uppercase tracking-wide">{title}</CardDescription>
      </CardHeader>
      <CardContent>
        <div
          className={
            "text-2xl font-light " +
            (tone === "destructive" ? "text-destructive" : "text-foreground")
          }
        >
          {value}
        </div>
      </CardContent>
    </Card>
  );
}