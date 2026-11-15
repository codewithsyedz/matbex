import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/hooks/useCurrency";
import { chargeOrder, confirmPayment } from "@/lib/pos/payments";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const POLL_MS = 3000;
const PREFERRED_METHODS = ["mada", "visa", "mastercard", "apple_pay", "stc_pay"] as const;

interface GatewayConfig {
  branch_id: string | null;
  allowed_methods: string[];
  channel: string;
}

type Phase = "creating" | "waiting" | "paid" | "failed";

interface Pending {
  amount: number;
  resolve: (intentId: string) => void;
  reject: (err: Error) => void;
}

export interface MoyasarChargeInput {
  amount: number;
  branchId?: string | null;
  description?: string;
}

/**
 * Card payment through the restaurant's own Moyasar account (Settings → Payment gateways):
 * the POS shows a QR code of Moyasar's payment page, the customer pays on their phone with
 * mada, Visa / Mastercard, Apple Pay or STC Pay, and the POS waits until Moyasar confirms.
 * `charge()` resolves with the payment intent id to send as the sale's cardTerminal reference;
 * the sales API checks that payment again before recording the sale.
 */
export function useMoyasarCheckout(branchId?: string | null) {
  const { tenant } = useAuth();
  const { data: config } = useQuery({
    queryKey: ["moyasar-pos-config", tenant?.id, branchId ?? null],
    enabled: !!tenant?.id,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await db
        .from("payment_gateway_configs")
        .select("branch_id, allowed_methods, channel")
        .eq("tenant_id", tenant!.id)
        .eq("gateway", "moyasar")
        .eq("enabled", true)
        .in("channel", ["pos", "both"]);
      if (error) throw error;
      const rows = (data ?? []) as GatewayConfig[];
      return rows.find((r) => r.branch_id && r.branch_id === branchId) ?? rows.find((r) => !r.branch_id) ?? null;
    },
  });
  const method = PREFERRED_METHODS.find((m) => config?.allowed_methods?.includes(m)) ?? null;

  const [pending, setPending] = useState<Pending | null>(null);
  const [phase, setPhase] = useState<Phase>("creating");
  const [payUrl, setPayUrl] = useState<string | null>(null);
  const [intentId, setIntentId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  pendingRef.current = pending;

  const finish = useCallback((ok: boolean, value: string | Error) => {
    const p = pendingRef.current;
    setPending(null);
    if (!p) return;
    if (ok) p.resolve(value as string);
    else p.reject(value as Error);
  }, []);

  const charge = useCallback(
    (input: MoyasarChargeInput) =>
      new Promise<string>((resolve, reject) => {
        if (!method) {
          reject(new Error("Moyasar is not enabled for the POS: turn it on in Settings → Payment gateways"));
          return;
        }
        setPhase("creating");
        setPayUrl(null);
        setIntentId(null);
        setMessage(null);
        setPending({ amount: input.amount, resolve, reject });
        chargeOrder({
          amount: input.amount,
          method,
          branchId: input.branchId ?? branchId ?? undefined,
          channel: "pos",
          idempotencyKey: crypto.randomUUID(),
          metadata: input.description ? { description: input.description } : undefined,
        })
          .then((r) => {
            if (!r.intentId || !(r.qrPayload || r.redirectUrl)) throw new Error("Moyasar did not return a payment page");
            setIntentId(r.intentId);
            setPayUrl(r.qrPayload ?? r.redirectUrl ?? null);
            setPhase("waiting");
          })
          .catch((e: Error) => {
            setPhase("failed");
            setMessage(e.message);
          });
      }),
    [method, branchId],
  );

  // Poll the server (which asks Moyasar) until the payment is paid or ends.
  useEffect(() => {
    if (phase !== "waiting" || !intentId) return;
    let stopped = false;
    const tick = async () => {
      try {
        const s = await confirmPayment(intentId);
        if (stopped) return;
        if (s === "captured") {
          setPhase("paid");
          setTimeout(() => finish(true, intentId), 700);
          return;
        }
        if (s === "failed") {
          setPhase("failed");
          setMessage("The payment failed or expired. Start again or choose another payment method.");
          return;
        }
      } catch {
        // Network blip: keep polling.
      }
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    };
    let timer = setTimeout(tick, POLL_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [phase, intentId, finish]);

  const cancel = () => finish(false, new Error(phase === "failed" && message ? message : "Card payment cancelled"));

  return {
    enabled: !!method,
    charge,
    dialog: (
      <MoyasarCheckoutDialog
        open={!!pending}
        amount={pending?.amount ?? 0}
        phase={phase}
        payUrl={payUrl}
        message={message}
        onCancel={cancel}
      />
    ),
  };
}

function MoyasarCheckoutDialog({
  open, amount, phase, payUrl, message, onCancel,
}: { open: boolean; amount: number; phase: Phase; payUrl: string | null; message: string | null; onCancel: () => void }) {
  const { format: formatCurrency } = useCurrency();
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && phase !== "paid") onCancel(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Card payment · {formatCurrency(amount)}</DialogTitle>
          <DialogDescription>
            The customer scans the code and pays with mada, Visa / Mastercard, Apple Pay or STC Pay. The sale is recorded once Moyasar confirms.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-3 py-2">
          {phase === "creating" && <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" aria-label="Creating payment" />}
          {phase === "waiting" && payUrl && (
            <>
              <div className="rounded-lg bg-white p-3"><QRCodeSVG value={payUrl} size={220} /></div>
              <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Waiting for payment…</p>
              <a href={payUrl} target="_blank" rel="noreferrer" className="text-xs text-primary underline">Open the payment page on this device</a>
            </>
          )}
          {phase === "paid" && <p className="flex items-center gap-2 font-medium text-success"><CheckCircle2 className="h-6 w-6" /> Paid</p>}
          {phase === "failed" && (
            <p className="flex items-start gap-2 text-sm text-destructive"><XCircle className="h-5 w-5 shrink-0" /> {message ?? "The payment could not be started."}</p>
          )}
        </div>
        {phase !== "paid" && (
          <Button variant="outline" onClick={onCancel}>{phase === "failed" ? "Close" : "Cancel payment"}</Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
