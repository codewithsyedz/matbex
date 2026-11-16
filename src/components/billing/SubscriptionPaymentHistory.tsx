import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import QRCode from "qrcode";
import { FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { generateZatcaQrBase64 } from "@/lib/zatca/tlv";

interface Invoice {
  invoice_number: string;
  issued_at: string;
  period_start: string | null;
  period_end: string | null;
  seller: { name: string; vat_number: string | null; cr_number: string | null; address: string | null };
  seller_incomplete: boolean;
  buyer: { name: string; vat_number: string | null };
  lines: { description: string; amount: number }[];
  subtotal: number;
  vat_rate: number;
  vat_amount: number;
  total: number;
  currency: string;
  payment_reference: string | null;
}

const sar = (n: number) => Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s: string | null | undefined) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

async function openInvoice(paymentId: string) {
  const { data, error } = await db.functions.invoke("subscription-invoice", { body: { payment_id: paymentId } });
  if (error) throw new Error(error.message);
  const inv = data as Invoice;
  const qr = await QRCode.toDataURL(generateZatcaQrBase64({
    sellerName: inv.seller.name,
    vatNumber: inv.seller.vat_number ?? "",
    timestamp: new Date(inv.issued_at).toISOString(),
    invoiceTotal: inv.total.toFixed(2),
    vatTotal: inv.vat_amount.toFixed(2),
  }), { margin: 1, width: 180 });
  const w = window.open("", "_blank", "width=820,height=1000");
  if (!w) throw new Error("Allow pop-ups to open the invoice");
  w.document.write(`<!doctype html><html dir="ltr"><head><meta charset="utf-8"><title>${esc(inv.invoice_number)}</title>
<style>body{font-family:system-ui,sans-serif;color:#111;max-width:760px;margin:24px auto;padding:0 16px}h1{font-size:22px;margin:0}
.muted{color:#555;font-size:13px}table{width:100%;border-collapse:collapse;margin-top:16px}td,th{padding:8px;border-bottom:1px solid #ddd;text-align:left}
th:last-child,td:last-child{text-align:right}.tot td{border:0;padding:4px 8px}.grid{display:flex;justify-content:space-between;gap:24px;margin-top:16px}
.warn{background:#fdf3d7;padding:8px;border-radius:6px;font-size:13px;margin-top:12px}@media print{.noprint{display:none}}</style></head><body>
<div class="grid"><div><h1>Tax Invoice · فاتورة ضريبية</h1><p class="muted">${esc(inv.invoice_number)} · ${esc(format(new Date(inv.issued_at), "d MMM yyyy, HH:mm"))}</p></div>
<img src="${qr}" alt="ZATCA QR" width="120" height="120"></div>
${inv.seller_incomplete ? '<p class="warn">Seller details are incomplete (legal name, VAT number or address).</p>' : ""}
<div class="grid"><div><b>Seller</b><br>${esc(inv.seller.name)}<br>${inv.seller.vat_number ? `VAT ${esc(inv.seller.vat_number)}<br>` : ""}${inv.seller.cr_number ? `CR ${esc(inv.seller.cr_number)}<br>` : ""}${esc(inv.seller.address)}</div>
<div><b>Buyer</b><br>${esc(inv.buyer.name)}<br>${inv.buyer.vat_number ? `VAT ${esc(inv.buyer.vat_number)}` : ""}</div></div>
<table><thead><tr><th>Description</th><th>Amount (SAR, excl. VAT)</th></tr></thead><tbody>
${inv.lines.map((l) => `<tr><td>${esc(l.description)}</td><td>${sar(l.amount)}</td></tr>`).join("")}</tbody></table>
<table class="tot"><tr><td>Subtotal</td><td>${sar(inv.subtotal)}</td></tr><tr><td>VAT ${(inv.vat_rate * 100).toFixed(0)}%</td><td>${sar(inv.vat_amount)}</td></tr>
<tr><td><b>Total paid</b></td><td><b>SAR ${sar(inv.total)}</b></td></tr></table>
<p class="muted">${inv.period_start ? `Service period ${esc(String(inv.period_start).slice(0, 10))} – ${esc(String(inv.period_end ?? "").slice(0, 10))}. ` : ""}Paid online${inv.payment_reference ? ` (ref ${esc(inv.payment_reference)})` : ""}.</p>
<p class="noprint"><button onclick="window.print()">Print / Save as PDF</button></p></body></html>`);
  w.document.close();
}

/** Matbex subscription and add-on payments of this business, each with its tax invoice. */
export function SubscriptionPaymentHistory() {
  const { tenant } = useAuth();
  const [opening, setOpening] = useState<string | null>(null);
  const payments = useQuery({
    queryKey: ["subscription-payments", tenant?.id],
    enabled: !!tenant?.id,
    queryFn: async () => {
      const { data, error } = await (db as any).from("subscription_payments")
        .select("id, kind, mode, amount, vat_amount, invoice_number, paid_at, period_end")
        .eq("tenant_id", tenant!.id).eq("status", "paid").order("paid_at", { ascending: false }).limit(24);
      if (error) throw error;
      return (data ?? []) as { id: string; kind: string; mode: string; amount: number; vat_amount: number | null; invoice_number: string | null; paid_at: string; period_end: string | null }[];
    },
  });
  if (!payments.data?.length) return null;
  const label = (p: { kind: string; mode: string }) =>
    p.kind === "addon" ? "Add-on" : p.mode === "upgrade" ? "Upgrade" : p.mode === "renew" ? "Renewal" : p.kind === "registration" ? "First month" : "Plan";

  return (
    <Card className="border-border/40">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium">Payment history</CardTitle>
        <CardDescription>Your payments to Matbex, each with its tax invoice.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {payments.data.map((p) => (
          <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2">
            <span>{format(new Date(p.paid_at), "d MMM yyyy")} · {label(p)}{p.invoice_number ? ` · ${p.invoice_number}` : ""}</span>
            <span className="flex items-center gap-3">
              <span className="tabular-nums">SAR {sar(Number(p.amount))}</span>
              {p.invoice_number && (
                <Button size="sm" variant="outline" disabled={opening === p.id} onClick={async () => {
                  setOpening(p.id);
                  try { await openInvoice(p.id); } catch (e) { toast.error(e instanceof Error ? e.message : "Could not open the invoice"); }
                  finally { setOpening(null); }
                }}>
                  {opening === p.id ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <FileText className="h-4 w-4 mr-1" />}Invoice
                </Button>
              )}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
