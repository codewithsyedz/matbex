import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { FileText, Loader2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  printSubscriptionCreditNote,
  printSubscriptionInvoice,
  type SubscriptionCreditNoteDoc,
  type SubscriptionInvoiceDoc,
} from "@/lib/billing/subscriptionDocuments";

const sar = (n: number) => Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function fetchDoc<T>(body: Record<string, string>): Promise<T> {
  const { data, error } = await db.functions.invoke("subscription-invoice", { body });
  if (error) throw new Error(error.message);
  return data as T;
}

interface PaymentRow { id: string; kind: string; mode: string; amount: number; refunded_amount: number | null; invoice_number: string | null; paid_at: string }
interface RefundRow { id: string; payment_id: string; amount: number; credit_note_number: string; created_at: string }

/** Matbex subscription and add-on payments of this business, each with its tax invoice and credit notes. */
export function SubscriptionPaymentHistory() {
  const { tenant } = useAuth();
  const [opening, setOpening] = useState<string | null>(null);
  const history = useQuery({
    queryKey: ["subscription-payments", tenant?.id],
    enabled: !!tenant?.id,
    queryFn: async () => {
      const [p, r] = await Promise.all([
        db.from("subscription_payments")
          .select("id, kind, mode, amount, refunded_amount, invoice_number, paid_at")
          .eq("tenant_id", tenant!.id).eq("status", "paid").order("paid_at", { ascending: false }).limit(24),
        db.from("subscription_refunds")
          .select("id, payment_id, amount, credit_note_number, created_at")
          .eq("tenant_id", tenant!.id).order("created_at", { ascending: false }),
      ]);
      if (p.error) throw p.error;
      return { payments: (p.data ?? []) as PaymentRow[], refunds: (r.data ?? []) as RefundRow[] };
    },
  });
  if (!history.data?.payments.length) return null;
  const label = (p: { kind: string; mode: string }) =>
    p.kind === "addon" ? "Add-on" : p.mode === "upgrade" ? "Upgrade" : p.mode === "renew" ? "Renewal" : p.kind === "registration" ? "First month" : "Plan";

  const open = async (key: string, run: () => Promise<void>) => {
    setOpening(key);
    try { await run(); } catch (e) { toast.error(e instanceof Error ? e.message : "Could not open the document"); }
    finally { setOpening(null); }
  };

  return (
    <Card className="border-border/40">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium">Payment history</CardTitle>
        <CardDescription>Your payments to Matbex, each with its tax invoice; refunds come with a credit note.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {history.data.payments.map((p) => (
          <div key={p.id} className="rounded-md border p-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>{format(new Date(p.paid_at), "d MMM yyyy")} · {label(p)}{p.invoice_number ? ` · ${p.invoice_number}` : ""}</span>
              <span className="flex items-center gap-3">
                <span className="tabular-nums">SAR {sar(Number(p.amount))}</span>
                {p.invoice_number && (
                  <Button size="sm" variant="outline" disabled={opening === p.id}
                    onClick={() => open(p.id, async () => printSubscriptionInvoice(await fetchDoc<SubscriptionInvoiceDoc>({ payment_id: p.id })))}>
                    {opening === p.id ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <FileText className="h-4 w-4 mr-1" />}Invoice
                  </Button>
                )}
              </span>
            </div>
            {history.data.refunds.filter((r) => r.payment_id === p.id).map((r) => (
              <div key={r.id} className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t pt-2 text-muted-foreground">
                <span>{format(new Date(r.created_at), "d MMM yyyy")} · Refund · {r.credit_note_number}</span>
                <span className="flex items-center gap-3">
                  <span className="tabular-nums">− SAR {sar(Number(r.amount))}</span>
                  <Button size="sm" variant="outline" disabled={opening === r.id}
                    onClick={() => open(r.id, async () => printSubscriptionCreditNote(await fetchDoc<SubscriptionCreditNoteDoc>({ refund_id: r.id })))}>
                    {opening === r.id ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Undo2 className="h-4 w-4 mr-1" />}Credit note
                  </Button>
                </span>
              </div>
            ))}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
