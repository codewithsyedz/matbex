import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Printer,
  Banknote,
  Loader2,
  RefreshCw,
  Wifi,
  WifiOff,
  AlertTriangle,
  CheckCircle2,
  RotateCcw,
  ListChecks,
} from "lucide-react";
import { toast } from "sonner";
import {
  useHardwareConfig,
  useHardwareStatus,
  usePrintQueue,
} from "@/hooks/useHardware";
import { hardwareManager } from "@/lib/hardware";
import type { PrinterTransport, DrawerTransport } from "@/lib/hardware";
import { ReceiptHistoryList } from "@/components/pos/ReceiptHistoryList";

const TRANSPORT_LABELS: Record<PrinterTransport, string> = {
  qz: "QZ Tray (USB / Bluetooth / Network)",
  network: "Network printer (HTTP bridge)",
  bluetooth: "Web Bluetooth ESC/POS",
  usb: "USB via QZ Tray",
  browser: "Browser print dialog",
  webusb: "Web USB (Chrome / Edge)",
  "local-agent": "Local Print Agent (127.0.0.1)",
};

export function HardwareSettings() {
  const { config, updateConfig } = useHardwareConfig();
  const { printers, detecting, error, detect } = useHardwareStatus();
  const { jobs, online, pending, failed, retry, drain } = usePrintQueue();
  const [testing, setTesting] = useState(false);

  // Auto-detect printers on first load for transports that support it.
  useEffect(() => {
    if (config.preferredTransport === "qz" || config.preferredTransport === "network") {
      void detect();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.preferredTransport]);

  const printerStatus = useMemo(() => {
    if (detecting) return { label: "Detecting…", tone: "muted" as const, Icon: Loader2 };
    if (error) return { label: "Bridge unavailable", tone: "destructive" as const, Icon: AlertTriangle };
    if (printers.length > 0) return { label: `${printers.length} printer${printers.length === 1 ? "" : "s"} found`, tone: "success" as const, Icon: CheckCircle2 };
    return { label: "No printers detected", tone: "warning" as const, Icon: AlertTriangle };
  }, [detecting, error, printers]);

  const handleTestPrint = async () => {
    setTesting(true);
    try {
      const job = await hardwareManager.printReceipt({
        receiptNumber: `TEST-${Date.now().toString().slice(-5)}`,
        restaurantName: "Matbex - Test Receipt",
        date: new Date().toISOString(),
        items: [
          { name: "Test item A", quantity: 2, unitPrice: 10, total: 20 },
          { name: "Test item B", quantity: 1, unitPrice: 5.5, total: 5.5 },
        ],
        subtotal: 25.5,
        tax: 0,
        total: 25.5,
        paymentMethod: "Cash",
        header: "Test print from Hardware Settings",
        footer: "If you can read this, your printer is configured.",
        openDrawer: false,
      });
      const result = await hardwareManager.waitForJobCompletion(job.id, 8000);
      if (result?.status === "done") {
        toast.success("Test receipt printed");
      } else if (result?.status === "failed") {
        toast.error(result.lastError || "Test failed");
      } else {
        toast.info("Test receipt queued and still trying to print");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Test failed");
    } finally {
      setTesting(false);
    }
  };

  const handleDrawerTest = async () => {
    const ok = await hardwareManager.openDrawer();
    if (ok) toast.success("Cash drawer kicked");
    else toast.warning("Drawer did not respond - check connection");
  };

  const handleReprintLast = async () => {
    const job = await hardwareManager.reprintLast();
    if (!job) toast.info("No previous receipt to reprint");
    else toast.success("Reprinting last receipt");
  };

  return (
    <div className="space-y-6">
      {/* Connection summary */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Printer className="h-5 w-5 text-primary" />
              </div>
              <div>
                <CardTitle className="text-base font-medium">Receipt printer</CardTitle>
                <CardDescription>Configure the device used to print customer receipts</CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge
                variant={online ? "secondary" : "destructive"}
                className="gap-1"
              >
                {online ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
                {online ? "Online" : "Offline"}
              </Badge>
              <Badge
                variant={
                  printerStatus.tone === "success"
                    ? "secondary"
                    : printerStatus.tone === "destructive"
                      ? "destructive"
                      : "outline"
                }
                className="gap-1"
              >
                <printerStatus.Icon className={`h-3 w-3 ${detecting ? "animate-spin" : ""}`} />
                {printerStatus.label}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Connection</Label>
              <Select
                value={config.preferredTransport}
                onValueChange={(v) => {
                  const next = v as PrinterTransport;
                  // Auto-correct the port when switching between network (raw 9100)
                  // and the Local Print Agent (HTTP 9911).
                  const port =
                    next === "local-agent"
                      ? (config.networkPort === 9100 || !config.networkPort ? 9911 : config.networkPort)
                      : (config.networkPort === 9911 || !config.networkPort ? 9100 : config.networkPort);
                  const host =
                    next === "local-agent" && !config.networkHost ? "127.0.0.1" : config.networkHost;
                  updateConfig({
                    preferredTransport: next,
                    networkPort: port,
                    networkHost: host,
                    defaultPrinterId: null,
                    defaultPrinterName: null,
                  });
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(TRANSPORT_LABELS) as PrinterTransport[]).map((t) => (
                    <SelectItem key={t} value={t}>{TRANSPORT_LABELS[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                QZ Tray is recommended for USB and printer-attached cash drawers.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Default printer</Label>
              <div className="flex gap-2">
                <Select
                  value={config.defaultPrinterId ?? ""}
                  onValueChange={(v) => {
                    const p = printers.find((x) => x.id === v);
                    updateConfig({ defaultPrinterId: v || null, defaultPrinterName: p?.name ?? null });
                  }}
                  disabled={printers.length === 0}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={printers.length ? "Select printer" : "No printers detected"} />
                  </SelectTrigger>
                  <SelectContent>
                    {printers.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}{p.isDefault ? " (system default)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="outline" size="icon" onClick={detect} disabled={detecting} title="Re-detect">
                  <RefreshCw className={`h-4 w-4 ${detecting ? "animate-spin" : ""}`} />
                </Button>
              </div>
            </div>
          </div>

          {(config.preferredTransport === "network" || config.preferredTransport === "local-agent") && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{config.preferredTransport === "local-agent" ? "Agent host" : "Printer host"}</Label>
                <Input
                  placeholder={config.preferredTransport === "local-agent" ? "127.0.0.1" : "192.168.1.100"}
                  value={config.networkHost ?? ""}
                  onChange={(e) => updateConfig({ networkHost: e.target.value || null })}
                />
              </div>
              <div className="space-y-2">
                <Label>Port</Label>
                <Input
                  type="number"
                  value={config.networkPort ?? (config.preferredTransport === "local-agent" ? 9911 : 9100)}
                  onChange={(e) =>
                    updateConfig({
                      networkPort:
                        Number(e.target.value) ||
                        (config.preferredTransport === "local-agent" ? 9911 : 9100),
                    })
                  }
                />
                {config.preferredTransport === "local-agent" && (
                  <p className="text-xs text-muted-foreground">
                    Default for Matbex Print Agent is <code>9911</code>.
                  </p>
                )}
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {error}. Make sure QZ Tray is running, or pick a different connection above.
            </div>
          )}

          <Separator />

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={handleTestPrint} disabled={testing} variant="outline" size="sm">
              {testing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Printer className="h-4 w-4 mr-2" />}
              Print test receipt
            </Button>
            <Button onClick={handleReprintLast} variant="outline" size="sm">
              <RotateCcw className="h-4 w-4 mr-2" />
              Reprint last receipt
            </Button>
          </div>

          <Separator />

          <div className="space-y-2">
            <Label className="text-sm">Recent receipts</Label>
            <p className="text-xs text-muted-foreground">
              Pick any of the last 10 receipts to reprint.
            </p>
            <ReceiptHistoryList limit={10} />
          </div>
        </CardContent>
      </Card>

      {/* Cash drawer */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                <Banknote className="h-5 w-5 text-emerald-600" />
              </div>
              <div>
                <CardTitle className="text-base font-medium">Cash drawer</CardTitle>
                <CardDescription>RJ11 drawer attached to the receipt printer (or direct serial)</CardDescription>
              </div>
            </div>
            <Switch
              checked={config.autoOpenDrawerOnCash}
              onCheckedChange={(v) => updateConfig({ autoOpenDrawerOnCash: v })}
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Connection</Label>
              <Select
                value={config.drawerTransport}
                onValueChange={(v) => updateConfig({ drawerTransport: v as DrawerTransport })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="printer">Via printer RJ11 (recommended)</SelectItem>
                  <SelectItem value="serial">Direct serial / USB</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>ESC/POS kick code</Label>
              <Input
                value={config.drawerKickCode}
                onChange={(e) => updateConfig({ drawerKickCode: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Comma-separated decimal bytes, e.g. <code>27,112,0,25,250</code>.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={handleDrawerTest} variant="outline" size="sm">
              <Banknote className="h-4 w-4 mr-2" />
              Test drawer kick
            </Button>
            <span className="text-xs text-muted-foreground">
              Auto-opens after every successful cash sale when enabled.
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Print queue */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-sky-500/10 flex items-center justify-center">
                <ListChecks className="h-5 w-5 text-sky-600" />
              </div>
              <div>
                <CardTitle className="text-base font-medium">Print queue</CardTitle>
                <CardDescription>
                  Jobs persist across refreshes and resume automatically when the printer or internet returns.
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline">{pending} pending</Badge>
              <Badge variant={failed ? "destructive" : "outline"}>{failed} failed</Badge>
              <Button size="sm" variant="outline" onClick={() => drain()}>
                <RefreshCw className="h-4 w-4 mr-1" /> Run now
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <PrintQueueTabs jobs={jobs} retry={retry} drain={drain} failed={failed} />
        </CardContent>
      </Card>
    </div>
  );
}

function PrintQueueTabs({
  jobs,
  retry,
  drain,
  failed,
}: {
  jobs: import("@/lib/hardware").PrintJob[];
  retry: (id: string) => void;
  drain: () => void;
  failed: number;
}) {
  const sorted = [...jobs].reverse();
  const all = sorted.slice(0, 50);
  const failedJobs = sorted.filter((j) => j.status === "failed");
  const pendingJobs = sorted.filter(
    (j) => j.status === "pending" || j.status === "queued-offline" || j.status === "printing",
  );

  const retryAllFailed = () => failedJobs.forEach((j) => retry(j.id));

  return (
    <Tabs defaultValue={failed > 0 ? "failed" : "all"}>
      <TabsList>
        <TabsTrigger value="all" className="gap-1.5">
          All <Badge variant="outline" className="h-4 px-1 text-[10px]">{all.length}</Badge>
        </TabsTrigger>
        <TabsTrigger value="pending" className="gap-1.5">
          Pending <Badge variant="outline" className="h-4 px-1 text-[10px]">{pendingJobs.length}</Badge>
        </TabsTrigger>
        <TabsTrigger value="failed" className="gap-1.5">
          Failed{" "}
          <Badge
            variant={failedJobs.length > 0 ? "destructive" : "outline"}
            className="h-4 px-1 text-[10px]"
          >
            {failedJobs.length}
          </Badge>
        </TabsTrigger>
      </TabsList>

      <TabsContent value="all" className="mt-4">
        <JobList jobs={all} retry={retry} emptyText="No print jobs yet." />
      </TabsContent>
      <TabsContent value="pending" className="mt-4">
        <JobList jobs={pendingJobs} retry={retry} emptyText="No pending jobs." />
      </TabsContent>
      <TabsContent value="failed" className="mt-4 space-y-3">
        {failedJobs.length > 0 && (
          <div className="flex items-center justify-between rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs">
            <span className="text-destructive">
              {failedJobs.length} receipt{failedJobs.length === 1 ? "" : "s"} failed to print after retries.
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={drain}>
                <RefreshCw className="h-3.5 w-3.5 mr-1" /> Run queue
              </Button>
              <Button size="sm" variant="destructive" onClick={retryAllFailed}>
                <RotateCcw className="h-3.5 w-3.5 mr-1" /> Retry all
              </Button>
            </div>
          </div>
        )}
        <JobList jobs={failedJobs} retry={retry} emptyText="No failed jobs - everything printed cleanly." />
      </TabsContent>
    </Tabs>
  );
}

function JobList({
  jobs,
  retry,
  emptyText,
}: {
  jobs: import("@/lib/hardware").PrintJob[];
  retry: (id: string) => void;
  emptyText: string;
}) {
  if (jobs.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-6">{emptyText}</p>;
  }
  return (
    <div className="divide-y rounded-md border">
      {jobs.map((job) => (
        <div key={job.id} className="flex items-center justify-between gap-3 p-3 text-sm">
          <div className="min-w-0">
            <div className="font-medium truncate">
              Receipt #{job.payload.receiptNumber} · {job.payload.paymentMethod}
            </div>
            <div className="text-xs text-muted-foreground">
              {new Date(job.createdAt).toLocaleString()} · attempts {job.attempts}
              {job.lastError ? ` · ${job.lastError}` : ""}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <StatusBadge status={job.status} />
            {(job.status === "failed" || job.status === "queued-offline") && (
              <Button size="sm" variant="ghost" onClick={() => retry(job.id)}>
                <RotateCcw className="h-3.5 w-3.5 mr-1" /> Retry
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    pending: { label: "Pending", variant: "outline" },
    printing: { label: "Printing", variant: "secondary" },
    done: { label: "Done", variant: "secondary" },
    failed: { label: "Failed", variant: "destructive" },
    "queued-offline": { label: "Queued (offline)", variant: "outline" },
  };
  const meta = map[status] ?? { label: status, variant: "outline" as const };
  return <Badge variant={meta.variant}>{meta.label}</Badge>;
}