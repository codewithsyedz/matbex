import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useCurrency } from "@/hooks/useCurrency";
import { refundCardPayment, useCardPayment } from "@/lib/pos/cardRefund";

const MIN_REASON = 3;

/**
 * Confirm a void with a required reason. Sales are never deleted: the server records a
 * negative mirror sale, returns stock and refunds an open shift's drawer
 * (POST /api/v1/pos/sales/:id/void); the reason is stored on the original sale.
 */
export function VoidSaleDialog({
  receipt,
  saleId,
  onConfirm,
  children,
}: {
  receipt: string | null;
  /** When the sale was paid online by card (Moyasar), offer to refund the card too. */
  saleId?: string | null;
  /** Resolve false when the void failed (then no refund is attempted). */
  onConfirm: (reason: string) => Promise<void | boolean> | void | boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { format: money } = useCurrency();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [refundCard, setRefundCard] = useState(true);
  const card = useCardPayment({ saleId }, open);
  const refundable = card.data?.refundable ?? 0;
  const ok = reason.trim().length >= MIN_REASON;

  const confirm = async () => {
    if (!ok) return;
    setBusy(true);
    try {
      const voided = await onConfirm(reason.trim());
      if (voided !== false && refundCard && card.data && refundable > 0) {
        try {
          await refundCardPayment(card.data.intentId, refundable);
          toast.success(`${money(refundable)} refunded to the customer's card`);
          void qc.invalidateQueries({ queryKey: ["card-payment"] });
        } catch (e) {
          toast.error(`The sale was voided, but the card refund failed: ${e instanceof Error ? e.message : "unknown error"}`);
        }
      }
      setOpen(false);
      setReason("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setReason("");
      }}
    >
      <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("app.sales.delete.title")}</AlertDialogTitle>
          <AlertDialogDescription>{t("app.sales.delete.desc", { receipt: receipt ?? "" })}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2">
          <Label htmlFor="void-reason">{t("app.sales.delete.reasonLabel")}</Label>
          <Textarea
            id="void-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("app.sales.delete.reasonPlaceholder")}
            maxLength={500}
            rows={3}
            autoFocus
          />
          {refundable > 0 && (
            <div className="flex items-start gap-2 rounded-md border p-2">
              <Checkbox id="void-refund-card" checked={refundCard} onCheckedChange={(v) => setRefundCard(v === true)} />
              <Label htmlFor="void-refund-card" className="text-sm font-normal leading-snug">
                Also refund {money(refundable)} to the customer's card (paid online through {card.data?.gateway === "moyasar" ? "Moyasar" : card.data?.gateway}).
              </Label>
            </div>
          )}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{t("app.sales.actions.cancel")}</AlertDialogCancel>
          <Button variant="destructive" onClick={confirm} disabled={!ok || busy}>
            {t("app.sales.delete.confirm")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
