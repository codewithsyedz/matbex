import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCurrency } from "@/hooks/useCurrency";
import { refundCardPayment, useCardPayment } from "@/lib/pos/cardRefund";

/**
 * "Refund to card" for a payment taken online (Moyasar) for a POS sale or an online order:
 * full by default, or part of it. Owners and managers only (the server checks).
 */
export function CardRefundButton({ saleId, orderId, onRefunded }: { saleId?: string | null; orderId?: string | null; onRefunded?: () => void }) {
  const qc = useQueryClient();
  const { format: money } = useCurrency();
  const payment = useCardPayment({ saleId, orderId });
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);

  const p = payment.data;
  if (!p) return null;
  if (p.refundable <= 0) {
    return <p className="text-xs text-muted-foreground">Card payment of {money(p.amount)} refunded to the customer.</p>;
  }

  const value = Number(amount || p.refundable);
  const valid = Number.isFinite(value) && value > 0 && value <= p.refundable + 0.005;

  const confirm = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      await refundCardPayment(p.intentId, Math.round(value * 100) / 100);
      toast.success(`${money(value)} refunded to the customer's card`);
      setOpen(false);
      setAmount("");
      void qc.invalidateQueries({ queryKey: ["card-payment"] });
      onRefunded?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The refund failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setAmount(""); }}>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm"><Undo2 className="h-4 w-4 mr-1" /> Refund to card</Button>
      </AlertDialogTrigger>
      {/* Opened from the order details dialog: stack above it. */}
      <AlertDialogContent className="z-[60]" overlayClassName="z-[60]">
        <AlertDialogHeader>
          <AlertDialogTitle>Refund to the customer's card</AlertDialogTitle>
          <AlertDialogDescription>
            Paid online {money(p.amount)}{p.refunded > 0 ? `, already refunded ${money(p.refunded)}` : ""}. The money goes back
            to the card or wallet the customer paid with; banks usually show it within a few days. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-1">
          <Label htmlFor="card-refund-amount">Amount (up to {money(p.refundable)})</Label>
          <Input id="card-refund-amount" type="number" inputMode="decimal" min={0.01} step="0.01" max={p.refundable}
            placeholder={p.refundable.toFixed(2)} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <Button variant="destructive" onClick={confirm} disabled={!valid || busy}>
            {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Refund {valid ? money(value) : ""}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
