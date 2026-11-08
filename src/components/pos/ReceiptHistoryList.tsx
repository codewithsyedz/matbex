import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Printer, RotateCcw, Eye, Trash2, Download } from "lucide-react";
import { toast } from "sonner";
import { hardwareManager, PRINT_QUEUE_EVENT } from "@/lib/hardware";
import type { PrintJob } from "@/lib/hardware";
import { useCurrency } from "@/hooks/useCurrency";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { QRCodeSVG } from "qrcode.react";
import { useTranslation } from "react-i18next";

interface Props {
  limit?: number;
  className?: string;
  emptyHint?: string;
}

export function ReceiptHistoryList({ limit = 10, className, emptyHint }: Props) {
  const { t, i18n } = useTranslation();
  const { format: formatCurrency } = useCurrency();
  const [jobs, setJobs] = useState<PrintJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [previewJob, setPreviewJob] = useState<PrintJob | null>(null);
  const [todayOnly, setTodayOnly] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [search, setSearch] = useState("");

  // Fetch a wider slice from history so the "today" filter stays meaningful;
  // we still cap the rendered list to `limit` after filtering.
  const refresh = useCallback(async () => {
    setJobs(await hardwareManager.getReceiptHistory(Math.max(limit, 100)));
    setLoading(false);
  }, [limit]);

  useEffect(() => {
    void refresh();
    const onChange = () => void refresh();
    window.addEventListener(PRINT_QUEUE_EVENT, onChange);
    return () => window.removeEventListener(PRINT_QUEUE_EVENT, onChange);
  }, [refresh]);

  const reprint = async (id: string) => {
    setBusyId(id);
    try {
      const job = await hardwareManager.reprintJob(id);
      if (job) toast.success(t("app.pos.receipts.reprinting", { number: job.payload.receiptNumber }));
      else toast.warning(t("app.pos.receipts.empty"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("app.pos.receipts.reprintFailed"));
    } finally {
      setBusyId(null);
    }
  };

  const handleClear = async () => {
    setClearing(true);
    try {
      const removed = await hardwareManager.clearReceiptHistory();
      toast.success(t("app.pos.receipts.cleared", { count: removed }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("app.pos.receipts.clear"));
    } finally {
      setClearing(false);
    }
  };

  const handleExportCsv = () => {
    if (visibleJobs.length === 0) {
      toast.info(t("app.pos.receipts.empty"));
      return;
    }
    const esc = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const headers = [
      "Receipt #",
      "Printed At",
      "Payment Method",
      "Cashier",
      "Customer",
      "Items",
      "Subtotal",
      "Tax",
      "Total",
      "Status",
      "Attempts",
    ];
    const rows = visibleJobs.map((j) => {
      const p = j.payload;
      const items = p.items
        .map((it) => `${it.quantity}× ${it.name}${it.size ? ` (${it.size})` : ""}`)
        .join(" | ");
      return [
        p.receiptNumber,
        new Date(j.createdAt).toISOString(),
        p.paymentMethod,
        p.cashierName ?? "",
        p.customerName ?? "",
        items,
        p.subtotal,
        p.tax,
        p.total,
        j.status,
        j.attempts,
      ].map(esc).join(",");
    });
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `receipts-${todayOnly ? "today-" : ""}${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success(t("app.pos.receipts.exported", { count: visibleJobs.length }));
  };

  const visibleJobs = useMemo(() => {
    let list = jobs;
    if (todayOnly) {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const startMs = start.getTime();
      list = list.filter((j) => new Date(j.createdAt).getTime() >= startMs);
    }
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((j) => {
        const p = j.payload;
        if (String(p.receiptNumber).toLowerCase().includes(q)) return true;
        return p.items.some(
          (it) =>
            it.name.toLowerCase().includes(q) ||
            (it.size ? it.size.toLowerCase().includes(q) : false),
        );
      });
    }
    return list.slice(0, limit);
  }, [jobs, todayOnly, limit, search]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 me-2 animate-spin" /> {t("app.pos.receipts.loading")}
      </div>
    );
  }

  return (
    <>
      <div className="space-y-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("app.pos.receipts.search")}
          className="h-8 text-xs"
        />
        <div className="flex items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2">
            <Switch
              id="receipts-today-only"
              checked={todayOnly}
              onCheckedChange={setTodayOnly}
              className="scale-75"
            />
            <Label htmlFor="receipts-today-only" className="cursor-pointer text-xs">
              {t("app.pos.receipts.today")}
            </Label>
          </div>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 gap-1 text-xs text-muted-foreground hover:text-foreground"
              onClick={handleExportCsv}
              disabled={visibleJobs.length === 0}
            >
              <Download className="h-3.5 w-3.5" />
              {t("app.pos.receipts.export")}
            </Button>
            <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 gap-1 text-xs text-muted-foreground hover:text-destructive"
                disabled={jobs.length === 0 || clearing}
              >
                {clearing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
                {t("app.pos.receipts.clear")}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("app.pos.receipts.clearTitle")}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t("app.pos.receipts.clearDescription")}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("app.pos.receipts.cancel")}</AlertDialogCancel>
                <AlertDialogAction onClick={() => void handleClear()}>
                   {t("app.pos.receipts.confirmClear")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>

        {visibleJobs.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4">
            {emptyHint ?? t("app.pos.receipts.empty")}
          </p>
        ) : (
          <ScrollArea className={`max-h-72 ${className ?? ""}`}>
            <div className="divide-y rounded-md border">
              {visibleJobs.map((j) => (
            <div
              key={j.id}
              className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
            >
              <button
                type="button"
                className="min-w-0 flex-1 text-start hover:bg-muted/40 -mx-1 px-1 rounded"
                onClick={() => setPreviewJob(j)}
              >
                <div className="font-medium truncate flex items-center gap-1.5">
                  <Printer className="h-3.5 w-3.5 text-muted-foreground" />
                  #{j.payload.receiptNumber}
                  <span className="text-xs text-muted-foreground font-normal">
                   · {t(`app.pos.order.${j.payload.paymentMethod}`, { defaultValue: j.payload.paymentMethod })}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                   {new Date(j.createdAt).toLocaleString(i18n.language.startsWith("ar") ? "ar-SA" : "en-US")} ·{" "}
                  {formatCurrency(j.payload.total)}
                  {j.payload.cashierName ? ` · ${j.payload.cashierName}` : ""}
                </div>
              </button>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  size="sm"
                  variant="ghost"
                  className="gap-1"
                  onClick={() => setPreviewJob(j)}
                  aria-label={t("app.pos.receipts.preview")}
                >
                  <Eye className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="gap-1"
                  onClick={() => void reprint(j.id)}
                  disabled={busyId === j.id}
                >
                  {busyId === j.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RotateCcw className="h-3.5 w-3.5" />
                  )}
                   {t("app.pos.receipts.reprint")}
                </Button>
              </div>
            </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </div>

      <ReceiptPreviewDialog
        job={previewJob}
        onOpenChange={(o) => !o && setPreviewJob(null)}
        onReprint={async (id) => {
          await reprint(id);
          setPreviewJob(null);
        }}
        busyId={busyId}
        formatCurrency={formatCurrency}
         locale={i18n.language.startsWith("ar") ? "ar-SA" : "en-US"}
      />
    </>
  );
}

function ReceiptPreviewDialog({
  job,
  onOpenChange,
  onReprint,
  busyId,
  formatCurrency,
  locale,
}: {
  job: PrintJob | null;
  onOpenChange: (open: boolean) => void;
  onReprint: (id: string) => Promise<void>;
  busyId: string | null;
  formatCurrency: (n: number) => string;
  locale: string;
}) {
  const { t } = useTranslation();
  const open = !!job;
  const p = job?.payload;
  const qrValue = p
    ? JSON.stringify({
        r: p.receiptNumber,
        d: p.date,
        t: p.total,
        m: p.paymentMethod,
      })
    : "";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm p-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5">
           <DialogTitle className="text-sm">{t("app.pos.receipts.title")}</DialogTitle>
        </DialogHeader>
        {p && (
          <ScrollArea className="max-h-[70vh]">
            <div className="px-5 pb-3 font-mono text-xs leading-relaxed text-foreground">
              <div className="text-center space-y-0.5 py-2">
                <div className="font-bold text-sm">{p.restaurantName}</div>
                {p.header && <div className="text-[11px] text-muted-foreground">{p.header}</div>}
              </div>
              <Separator className="my-2" />
              <div className="grid grid-cols-2 gap-y-0.5 text-[11px]">
                 <span className="text-muted-foreground">{t("app.pos.receipts.receipt")}</span>
                 <span className="text-end">#{p.receiptNumber}</span>
                 <span className="text-muted-foreground">{t("app.pos.receipts.date")}</span>
                 <span className="text-end">{new Date(p.date).toLocaleString(locale)}</span>
                {p.cashierName && (
                  <>
                     <span className="text-muted-foreground">{t("app.pos.receipts.cashier")}</span>
                     <span className="text-end">{p.cashierName}</span>
                  </>
                )}
                {p.customerName && (
                  <>
                     <span className="text-muted-foreground">{t("app.pos.receipts.customer")}</span>
                     <span className="text-end">{p.customerName}</span>
                  </>
                )}
                 <span className="text-muted-foreground">{t("app.pos.receipts.payment")}</span>
                 <span className="text-end">{t(`app.pos.order.${p.paymentMethod}`, { defaultValue: p.paymentMethod })}</span>
              </div>
              <Separator className="my-2" />
              <div className="space-y-1">
                {p.items.map((it, i) => (
                  <div key={i} className="flex justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate">{it.name}{it.size ? ` (${it.size})` : ""}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {it.quantity} × {formatCurrency(it.unitPrice)}
                      </div>
                    </div>
                    <div className="shrink-0">{formatCurrency(it.total)}</div>
                  </div>
                ))}
              </div>
              <Separator className="my-2" />
              <div className="space-y-0.5 text-[11px]">
                <div className="flex justify-between">
                   <span className="text-muted-foreground">{t("app.pos.receipts.subtotal")}</span>
                  <span>{formatCurrency(p.subtotal)}</span>
                </div>
                <div className="flex justify-between">
                   <span className="text-muted-foreground">{t("app.pos.receipts.tax")}</span>
                  <span>{formatCurrency(p.tax)}</span>
                </div>
                <div className="flex justify-between font-bold text-sm pt-1">
                   <span>{t("app.pos.receipts.total")}</span>
                  <span>{formatCurrency(p.total)}</span>
                </div>
              </div>
              <Separator className="my-2" />
              <div className="flex flex-col items-center gap-1 py-2">
                {/* QR paper stays white in both themes for reliable scanning and printing. */}
                <div className="rounded bg-white p-1.5 ring-1 ring-border">
                  <QRCodeSVG value={qrValue} size={96} level="M" />
                </div>
                <div className="text-[10px] text-muted-foreground">
                   {t("app.pos.receipts.scanVerify")} · #{p.receiptNumber}
                </div>
              </div>
              {p.footer && (
                <div className="text-center text-[11px] text-muted-foreground pt-1">
                  {p.footer}
                </div>
              )}
              <div className="text-center text-[10px] text-muted-foreground pt-2">
                 {t("app.pos.receipts.printed")} {new Date(job.createdAt).toLocaleString(locale)} · {t("app.pos.receipts.attempts")} {job.attempts}
              </div>
            </div>
          </ScrollArea>
        )}
        <DialogFooter className="px-5 py-3 border-t bg-muted/30">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
             {t("app.pos.receipts.close")}
          </Button>
          <Button
            onClick={() => job && void onReprint(job.id)}
            disabled={!job || busyId === job.id}
            className="gap-1.5"
          >
            {job && busyId === job.id ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RotateCcw className="h-3.5 w-3.5" />
            )}
             {t("app.pos.receipts.reprint")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}