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

const MIN_REASON = 3;

/**
 * Confirm a void with a required reason. Sales are never deleted: the server records a
 * negative mirror sale, returns stock and refunds an open shift's drawer
 * (POST /api/v1/pos/sales/:id/void); the reason is stored on the original sale.
 */
export function VoidSaleDialog({
  receipt,
  onConfirm,
  children,
}: {
  receipt: string | null;
  onConfirm: (reason: string) => Promise<void> | void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const ok = reason.trim().length >= MIN_REASON;

  const confirm = async () => {
    if (!ok) return;
    setBusy(true);
    try {
      await onConfirm(reason.trim());
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
