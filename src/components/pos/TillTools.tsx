import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Banknote, CloudOff, Lock, RefreshCcw, Undo2, User } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { recordOfflineCashEvent, recordOfflineRefund } from "@/lib/offline/posService";
import { getAll, STORES } from "@/lib/offline/db";
import { runSync } from "@/lib/offline/syncEngine";
import { getTerminalId } from "@/lib/offline/terminal";
import { isOnline } from "@/lib/offline/connectivity";
import type { SyncQueueItem } from "@/lib/offline/types";
import type { TillStaff } from "@/hooks/useTillSession";
import { useTranslation } from "react-i18next";

const SHIFT_CACHE_KEY = "matbex.till.open_shift";

interface TillToolsProps {
  restaurantId: string;
  staff: TillStaff;
  onLock: () => void;
}

/**
 * Till action bar: who is signed in, how many records are still waiting to
 * sync, plus offline-capable cash-drawer movements and refunds.
 */
export function TillTools({ restaurantId, staff, onLock }: TillToolsProps) {
  const { t } = useTranslation();
  const [pending, setPending] = useState(0);
  const [online, setOnline] = useState(isOnline());
  const [cashOpen, setCashOpen] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const { data: shiftId } = useQuery({
    queryKey: ["till-open-shift", restaurantId],
    enabled: !!restaurantId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shifts")
        .select("id")
        .eq("restaurant_id", restaurantId)
        .eq("status", "open")
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      const id = data?.id ?? null;
      try {
        if (id) localStorage.setItem(SHIFT_CACHE_KEY, id);
        else localStorage.removeItem(SHIFT_CACHE_KEY);
      } catch {
        /* ignore */
      }
      return id;
    },
  });

  const effectiveShiftId =
    shiftId ?? (typeof localStorage !== "undefined" ? localStorage.getItem(SHIFT_CACHE_KEY) : null);

  // Pending queue counter + connectivity, polled cheaply.
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const queue = await getAll<SyncQueueItem>(STORES.queue);
        if (alive) setPending(queue.filter((q) => q.status !== "SYNCED").length);
      } catch {
        /* ignore */
      }
      if (alive) setOnline(isOnline());
    };
    void tick();
    const timer = window.setInterval(tick, 5000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  const syncNow = async () => {
    setSyncing(true);
    try {
      const terminalId = await getTerminalId();
      await runSync({ branchId: restaurantId, terminalId });
      toast.success(t("app.pos.till.syncFinished"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("app.pos.till.syncFailed"));
    } finally {
      setSyncing(false);
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-3 py-2">
        <Badge variant="secondary" className="gap-1.5 py-1">
          <User className="h-3.5 w-3.5" />
          {staff.display_name}
        </Badge>
        {!online && (
          <Badge variant="outline" className="gap-1.5 py-1 text-warning border-warning/40">
            <CloudOff className="h-3.5 w-3.5" /> {t("app.pos.till.offline")}
          </Badge>
        )}
        {pending > 0 && (
          <Badge variant="outline" className="py-1">
            {t("app.pos.till.waitingSync", { count: pending })}
          </Badge>
        )}
        <div className="ms-auto flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="min-h-[44px]"
            onClick={() => setCashOpen(true)}
          >
            <Banknote className="me-1.5 h-4 w-4" /> {t("app.pos.till.cashDrawer")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="min-h-[44px]"
            onClick={() => setRefundOpen(true)}
          >
            <Undo2 className="me-1.5 h-4 w-4" /> {t("app.pos.till.refund")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="min-h-[44px]"
            disabled={syncing || !online}
            onClick={() => void syncNow()}
          >
            <RefreshCcw className={`me-1.5 h-4 w-4 ${syncing ? "animate-spin" : ""}`} /> {t("app.pos.till.sync")}
          </Button>
          <Button variant="ghost" size="sm" className="min-h-[44px]" onClick={onLock}>
            <Lock className="me-1.5 h-4 w-4" /> {t("app.pos.till.lockAction")}
          </Button>
        </div>
      </div>

      <CashDrawerDialog
        open={cashOpen}
        onOpenChange={setCashOpen}
        restaurantId={restaurantId}
        cashierId={staff.user_id}
        shiftId={effectiveShiftId}
      />
      <RefundDialog
        open={refundOpen}
        onOpenChange={setRefundOpen}
        restaurantId={restaurantId}
        cashierId={staff.user_id}
        shiftId={effectiveShiftId}
      />
    </>
  );
}

/* ----------------------------- cash drawer ------------------------------ */

function CashDrawerDialog({
  open,
  onOpenChange,
  restaurantId,
  cashierId,
  shiftId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  restaurantId: string;
  cashierId: string;
  shiftId: string | null;
}) {
  const { t } = useTranslation();
  const [eventType, setEventType] = useState<"drop" | "payout" | "open" | "close">("drop");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const value = Number(amount);
    if (!shiftId) {
      toast.error(t("app.pos.till.cash.openShiftFirst"));
      return;
    }
    if (!(value > 0)) {
      toast.error(t("app.pos.till.amountRequired"));
      return;
    }
    setBusy(true);
    try {
      const res = await recordOfflineCashEvent({
        branchId: restaurantId,
        cashierId,
        shiftId,
        eventType,
        amount: value,
        paymentMethod: "cash",
        description: description || undefined,
      });
      toast.success(res.offline ? t("app.pos.till.savedOffline") : t("app.pos.till.cash.recorded"));
      setAmount("");
      setDescription("");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("app.pos.till.cash.failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("app.pos.till.cash.title")}</DialogTitle>
          <DialogDescription>
            {t("app.pos.till.cash.description")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>{t("app.pos.till.cash.movement")}</Label>
            <Select value={eventType} onValueChange={(v) => setEventType(v as typeof eventType)}>
              <SelectTrigger className="min-h-[44px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="drop">{t("app.pos.till.cash.drop")}</SelectItem>
                <SelectItem value="payout">{t("app.pos.till.cash.payout")}</SelectItem>
                <SelectItem value="open">{t("app.pos.till.cash.added")}</SelectItem>
                <SelectItem value="close">{t("app.pos.till.cash.counted")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="till-cash-amount">{t("app.pos.till.amount")}</Label>
            <Input
              id="till-cash-amount"
              inputMode="decimal"
              className="min-h-[44px]"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="till-cash-note">{t("app.pos.till.cash.note")}</Label>
            <Textarea
              id="till-cash-note"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>
          {!shiftId && (
            <p className="text-sm text-destructive">
              {t("app.pos.till.cash.noShift")}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button disabled={busy} onClick={() => void submit()}>
            {t("app.pos.till.record")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------- refunds -------------------------------- */

function RefundDialog({
  open,
  onOpenChange,
  restaurantId,
  cashierId,
  shiftId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  restaurantId: string;
  cashierId: string;
  shiftId: string | null;
}) {
  const { t } = useTranslation();
  const [receipt, setReceipt] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const value = Number(amount);
    if (!receipt.trim()) {
      toast.error(t("app.pos.till.refundForm.receiptRequired"));
      return;
    }
    if (!(value > 0)) {
      toast.error(t("app.pos.till.amountRequired"));
      return;
    }
    if (!reason.trim()) {
      toast.error(t("app.pos.till.refundForm.reasonRequired"));
      return;
    }
    setBusy(true);
    try {
      const res = await recordOfflineRefund({
        branchId: restaurantId,
        cashierId,
        shiftId,
        originalReceiptNumber: receipt.trim(),
        amount: value,
        paymentMethod: method,
        reason: reason.trim(),
      });
      toast.success(
        res.offline
          ? t("app.pos.till.refundForm.savedOffline", { reference: res.refundReference })
          : t("app.pos.till.refundForm.recorded", { reference: res.refundReference }),
      );
      setReceipt("");
      setAmount("");
      setReason("");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("app.pos.till.refundForm.failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("app.pos.till.refundForm.title")}</DialogTitle>
          <DialogDescription>
            {t("app.pos.till.refundForm.description")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="till-refund-receipt">{t("app.pos.till.refundForm.receipt")}</Label>
            <Input
              id="till-refund-receipt"
              className="min-h-[44px]"
              value={receipt}
              onChange={(e) => setReceipt(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="till-refund-amount">{t("app.pos.till.refundForm.amount")}</Label>
            <Input
              id="till-refund-amount"
              inputMode="decimal"
              className="min-h-[44px]"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t("app.pos.till.refundForm.method")}</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger className="min-h-[44px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">{t("app.sales.paymentMethods.cash")}</SelectItem>
                <SelectItem value="card">{t("app.sales.paymentMethods.card")}</SelectItem>
                <SelectItem value="other">{t("app.sales.paymentMethods.other")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="till-refund-reason">{t("app.pos.till.refundForm.reason")}</Label>
            <Textarea
              id="till-refund-reason"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button variant="destructive" disabled={busy} onClick={() => void submit()}>
            {t("app.pos.till.refundForm.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
