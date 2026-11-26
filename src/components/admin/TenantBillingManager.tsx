import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { differenceInCalendarDays, format } from "date-fns";
import { CalendarClock, CheckCircle2, Circle, FileText, Hourglass, Landmark, Loader2, Mail, Printer, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { db } from "@/integrations/db/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  printSubscriptionCreditNote,
  printSubscriptionInvoice,
  type SubscriptionCreditNoteDoc,
  type SubscriptionInvoiceDoc,
} from "@/lib/billing/subscriptionDocuments";

interface Payment {
  id: string; kind: string; mode: string; method: string; status: string;
  amount: number; subtotal: number | null; vat_amount: number | null; refunded_amount: number;
  months: number; branches: number; invoice_number: string | null;
  moyasar_invoice_id: string | null; moyasar_payment_id: string | null; reference: string | null; note: string | null;
  period_start: string | null; period_end: string | null; paid_at: string | null; created_at: string;
  plans: { name: string } | null; addons: { name: string } | null;
}
interface Refund { id: string; payment_id: string; amount: number; vat_amount: number; reason: string; method: string; credit_note_number: string; ended_period: boolean; created_at: string }
interface Overview {
  tenant: { id: string; name: string; status: string; billing_provider: string; current_period_end: string | null; trial_ends_at: string | null; plan: { id: string; name: string; price: number } | null };
  branches: number; vat_rate: number;
  plans: { id: string; name: string; price: number }[];
  payments: Payment[]; refunds: Refund[];
  totals: { paid: number; refunded: number };
  moyasar_ready: boolean;
  setup: { key: string; title: string; done: boolean }[];
  trial_emails: { at: string; status: string; to: string; day: number | null }[];
}

const PLAN: Record<string, string> = { starter: "Starter", pro: "Growth", enterprise: "Enterprise", trial: "Trial" };
const METHOD: Record<string, string> = { moyasar: "Moyasar", bank_transfer: "Bank transfer", cash: "Cash", other: "Other" };
const sar = (n: number | null | undefined) => `SAR ${Number(n ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (d: string | null | undefined) => (d ? format(new Date(d), "d MMM yyyy") : "—");

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.functions.invoke("admin-billing", { body });
  if (error) {
    // Show the function's own message (it explains what to fix).
    const ctx = (error as { context?: Response }).context;
    const msg = ctx && typeof ctx.json === "function" ? await ctx.json().then((b: { error?: string }) => b?.error).catch(() => null) : null;
    throw new Error(msg || error.message);
  }
  return data as T;
}

function what(p: Payment) {
  const plan = PLAN[p.plans?.name ?? ""] ?? p.plans?.name ?? "Plan";
  if (p.kind === "addon") return `Add-on: ${p.addons?.name ?? ""}`;
  if (p.kind === "registration") return `${plan}, first month`;
  if (p.mode === "upgrade") return `Upgrade to ${plan}`;
  return `${plan}, ${p.months === 12 ? "1 year" : `${p.months} month${p.months === 1 ? "" : "s"}`} × ${p.branches} branch${p.branches > 1 ? "es" : ""}`;
}

/** SuperAdmin → business → Billing: Matbex's own subscription payments for this business. */
export function TenantBillingManager({ tenantId }: { tenantId: string }) {
  const qc = useQueryClient();
  const key = ["admin-billing", tenantId];
  const overview = useQuery({ queryKey: key, queryFn: () => call<Overview>({ action: "overview", tenant_id: tenantId }) });
  const refresh = () => qc.invalidateQueries({ queryKey: key });

  const [extendOpen, setExtendOpen] = useState(false);
  const [trialOpen, setTrialOpen] = useState(false);
  const [offlineOpen, setOfflineOpen] = useState(false);
  const [refundOf, setRefundOf] = useState<Payment | null>(null);

  const resend = useMutation({
    mutationFn: (paymentId: string) => call<{ sent: number; recipients: string[] }>({ action: "resend_invoice", tenant_id: tenantId, payment_id: paymentId }),
    onSuccess: (r) => toast.success(r.sent ? `Invoice emailed to ${r.recipients.join(", ")}` : "No email was sent (no owner address, or email is off on this server)"),
    onError: (e: Error) => toast.error(e.message),
  });

  const resendNote = useMutation({
    mutationFn: (refundId: string) => call<{ sent: number; recipients: string[] }>({ action: "resend_credit_note", tenant_id: tenantId, refund_id: refundId }),
    onSuccess: (r) => toast.success(r.sent ? `Credit note emailed to ${r.recipients.join(", ")}` : "No email was sent (no owner address, or email is off on this server)"),
    onError: (e: Error) => toast.error(e.message),
  });
  const [printing, setPrinting] = useState<string | null>(null);
  const print = async (key: string, body: Record<string, string>, kind: "invoice" | "credit") => {
    setPrinting(key);
    try {
      const doc = await call<SubscriptionInvoiceDoc | SubscriptionCreditNoteDoc>({ action: "document", tenant_id: tenantId, ...body });
      if (kind === "invoice") await printSubscriptionInvoice(doc as SubscriptionInvoiceDoc);
      else await printSubscriptionCreditNote(doc as SubscriptionCreditNoteDoc);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not open the document");
    } finally {
      setPrinting(null);
    }
  };

  if (overview.isLoading) return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;
  if (overview.error || !overview.data) return <p className="text-sm text-destructive">{(overview.error as Error)?.message ?? "Could not load billing"}</p>;
  const o = overview.data;
  const t = o.tenant;
  const daysLeft = t.current_period_end ? differenceInCalendarDays(new Date(t.current_period_end), new Date()) : null;
  const refundsBy = (id: string) => o.refunds.filter((r) => r.payment_id === id);

  return (
    <div className="space-y-4">
      <Card className="border-border/40">
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0">
          <div>
            <CardTitle className="text-base font-medium">Subscription</CardTitle>
            <CardDescription>What this business pays Matbex, and until when.</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setExtendOpen(true)}><CalendarClock className="h-4 w-4 mr-1" />Change paid-until</Button>
            <Button size="sm" onClick={() => setOfflineOpen(true)}><Landmark className="h-4 w-4 mr-1" />Record bank transfer</Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
            <Stat label="Plan" value={PLAN[t.plan?.name ?? ""] ?? t.plan?.name ?? "No plan"} />
            <Stat label="Status" value={<Badge variant={t.status === "active" ? "default" : "secondary"} className="capitalize">{t.status.replace("_", " ")}</Badge>} />
            <Stat label="Paid until" value={t.current_period_end
              ? <>{day(t.current_period_end)} <span className={daysLeft! < 0 ? "text-destructive" : "text-muted-foreground"}>({daysLeft! < 0 ? `${-daysLeft!} days ago` : `${daysLeft} days left`})</span></>
              : t.trial_ends_at ? `Trial to ${day(t.trial_ends_at)}` : "—"} />
            <Stat label="Billed with" value={t.billing_provider === "moyasar" ? "Moyasar (pay per period)" : "Stripe (legacy)"} />
            <Stat label="Billed branches" value={o.branches} />
            <Stat label="Total paid" value={sar(o.totals.paid)} />
            <Stat label="Refunded" value={sar(o.totals.refunded)} />
            <Stat label="Online refunds" value={o.moyasar_ready ? "Available" : "Moyasar key not set"} />
          </div>
        </CardContent>
      </Card>

      <TrialCard overview={o} onExtend={() => setTrialOpen(true)} />

      <Card className="border-border/40">
        <CardHeader>
          <CardTitle className="text-base font-medium">Payments</CardTitle>
          <CardDescription>Every payment attempt, newest first. Paid payments carry a tax invoice; refunds get a credit note.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {o.payments.length === 0 ? <p className="text-sm text-muted-foreground">No payments yet.</p> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead><TableHead>For</TableHead><TableHead>Method</TableHead><TableHead>Status</TableHead>
                  <TableHead className="text-right">Amount (incl. VAT)</TableHead><TableHead>Invoice</TableHead><TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {o.payments.map((p) => {
                  const left = Number(p.amount) - Number(p.refunded_amount ?? 0);
                  return (
                    <TableRow key={p.id} className="align-top">
                      <TableCell className="whitespace-nowrap">{day(p.paid_at ?? p.created_at)}</TableCell>
                      <TableCell>
                        <div>{what(p)}</div>
                        {p.period_end && p.status === "paid" && <div className="text-xs text-muted-foreground">to {day(p.period_end)}</div>}
                        {p.note && <div className="text-xs text-muted-foreground">{p.note}</div>}
                        {refundsBy(p.id).map((r) => (
                          <div key={r.id} className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-destructive">
                            <span>Refund {sar(r.amount)} · {r.credit_note_number} · {day(r.created_at)} · {r.reason}{r.ended_period ? " · period ended" : ""}</span>
                            <button type="button" className="inline-flex items-center gap-1 text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                              disabled={printing === r.id} onClick={() => print(r.id, { refund_id: r.id }, "credit")}>
                              <Printer className="h-3 w-3" />Credit note
                            </button>
                            <button type="button" className="inline-flex items-center gap-1 text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                              disabled={resendNote.isPending} onClick={() => resendNote.mutate(r.id)}>
                              <Mail className="h-3 w-3" />Email
                            </button>
                          </div>
                        ))}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {METHOD[p.method] ?? p.method}
                        {(p.reference || p.moyasar_payment_id) && <div className="text-xs text-muted-foreground break-all">{p.reference ?? p.moyasar_payment_id}</div>}
                      </TableCell>
                      <TableCell>
                        <Badge variant={p.status === "paid" ? "default" : p.status === "pending" ? "secondary" : "outline"} className="capitalize">
                          {p.status === "paid" && Number(p.refunded_amount) > 0 ? (left > 0 ? "part refunded" : "refunded") : p.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums whitespace-nowrap">
                        {sar(p.amount)}
                        {p.vat_amount != null && <div className="text-xs text-muted-foreground">VAT {sar(p.vat_amount)}</div>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{p.invoice_number ?? "—"}</TableCell>
                      <TableCell className="whitespace-nowrap text-right">
                        {p.status === "paid" && p.invoice_number && (
                          <Button size="sm" variant="ghost" disabled={printing === p.id} onClick={() => print(p.id, { payment_id: p.id }, "invoice")} title="Print the invoice">
                            {printing === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                          </Button>
                        )}
                        {p.status === "paid" && p.invoice_number && (
                          <Button size="sm" variant="ghost" disabled={resend.isPending} onClick={() => resend.mutate(p.id)} title="Email the invoice to the owners">
                            <Mail className="h-4 w-4" />
                          </Button>
                        )}
                        {p.status === "paid" && left > 0 && (
                          <Button size="sm" variant="ghost" onClick={() => setRefundOf(p)} title="Refund"><Undo2 className="h-4 w-4" /></Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <TrialDialog open={trialOpen} onOpenChange={setTrialOpen} tenantId={tenantId} current={t.trial_ends_at} onDone={refresh} />
      <ExtendDialog open={extendOpen} onOpenChange={setExtendOpen} tenantId={tenantId} current={t.current_period_end} onDone={refresh} />
      <OfflineDialog open={offlineOpen} onOpenChange={setOfflineOpen} overview={o} onDone={refresh} />
      <RefundDialog payment={refundOf} onClose={() => setRefundOf(null)} tenantId={tenantId} moyasarReady={o.moyasar_ready} onDone={refresh} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return <div><p className="text-muted-foreground">{label}</p><div className="font-medium">{value}</div></div>;
}

function TrialCard({ overview: o, onExtend }: { overview: Overview; onExtend: () => void }) {
  const t = o.tenant;
  const onTrial = t.status === "trial" || t.status === "expired";
  const done = o.setup.filter((s) => s.done).length;
  const left = t.trial_ends_at ? differenceInCalendarDays(new Date(t.trial_ends_at), new Date()) : null;
  return (
    <Card className="border-border/40">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="text-base font-medium">Trial and setup</CardTitle>
          <CardDescription>
            {onTrial && t.trial_ends_at
              ? (left! >= 0 ? `Trial ends ${day(t.trial_ends_at)} (${left} days left).` : `Trial ended ${day(t.trial_ends_at)}.`)
              : "Setup steps from the first-week checklist."}
            {" "}{done} of {o.setup.length} setup steps done.
          </CardDescription>
        </div>
        {onTrial && <Button size="sm" variant="outline" onClick={onExtend}><Hourglass className="h-4 w-4 mr-1" />Extend trial</Button>}
      </CardHeader>
      <CardContent className="grid gap-4 text-sm md:grid-cols-2">
        <ul className="space-y-1.5">
          {o.setup.map((s) => (
            <li key={s.key} className="flex items-center gap-2">
              {s.done ? <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" /> : <Circle className="h-4 w-4 shrink-0 text-muted-foreground" />}
              <span className={s.done ? "" : "text-muted-foreground"}>{s.title}</span>
            </li>
          ))}
        </ul>
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">Trial emails (days 1, 7 and 12)</p>
          {o.trial_emails.length === 0 ? <p className="text-muted-foreground">None sent yet.</p> : (
            <ul className="space-y-1">
              {o.trial_emails.map((m, i) => (
                <li key={i} className="flex flex-wrap justify-between gap-2">
                  <span>Day {m.day ?? "?"} · {m.to}</span>
                  <span className="text-muted-foreground">{day(m.at)} · {m.status}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function TrialDialog({ open, onOpenChange, tenantId, current, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; tenantId: string; current: string | null; onDone: () => void }) {
  const [date, setDate] = useState("");
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (!open) return;
    // Default: 7 more days from the later of today and the current end.
    const base = Math.max(Date.now(), current ? new Date(current).getTime() : 0);
    setDate(new Date(base + 7 * 24 * 3600 * 1000).toISOString().slice(0, 10));
    setReason("");
  }, [open, current]);
  const save = useMutation({
    mutationFn: () => call({ action: "extend_trial", tenant_id: tenantId, trial_ends_at: new Date(`${date}T23:59:59+03:00`).toISOString(), reason }),
    onSuccess: () => { toast.success("Trial extended"); onOpenChange(false); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Extend trial</DialogTitle>
          <DialogDescription>
            The business keeps trial access until the end of this day (Riyadh time). A trial that already ended goes back to the
            Trial plan. The change and its reason are audited.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1"><Label htmlFor="tr-date">Trial ends on</Label><Input id="tr-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div className="space-y-1"><Label htmlFor="tr-reason">Reason</Label><Textarea id="tr-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. waiting for their POS hardware" /></div>
        </div>
        <DialogFooter>
          <Button onClick={() => save.mutate()} disabled={!date || reason.trim().length < 3 || save.isPending}>
            {save.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Extend trial
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ExtendDialog({ open, onOpenChange, tenantId, current, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; tenantId: string; current: string | null; onDone: () => void }) {
  const [date, setDate] = useState("");
  const [reason, setReason] = useState("");
  useEffect(() => { if (open) { setDate(current ? current.slice(0, 10) : ""); setReason(""); } }, [open, current]);
  const save = useMutation({
    // End of that day in Riyadh.
    mutationFn: () => call({ action: "extend", tenant_id: tenantId, period_end: new Date(`${date}T23:59:59+03:00`).toISOString(), reason }),
    onSuccess: () => { toast.success("Paid-until date changed"); onOpenChange(false); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Change paid-until date</DialogTitle>
          <DialogDescription>For goodwill days, outage credit or a correction. No payment or invoice is created; the change and its reason are audited.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1"><Label htmlFor="pu-date">Paid until</Label><Input id="pu-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div className="space-y-1"><Label htmlFor="pu-reason">Reason</Label><Textarea id="pu-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. 5 days credit for the 12 Nov outage" /></div>
        </div>
        <DialogFooter>
          <Button onClick={() => save.mutate()} disabled={!date || reason.trim().length < 3 || save.isPending}>
            {save.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OfflineDialog({ open, onOpenChange, overview, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; overview: Overview; onDone: () => void }) {
  const [planId, setPlanId] = useState("");
  const [period, setPeriod] = useState<"month" | "year">("month");
  const [branches, setBranches] = useState(1);
  const [method, setMethod] = useState<"bank_transfer" | "cash" | "other">("bank_transfer");
  const [reference, setReference] = useState("");
  const [subtotal, setSubtotal] = useState("");
  const [paidOn, setPaidOn] = useState("");
  const [note, setNote] = useState("");

  const plan = overview.plans.find((p) => p.id === planId);
  const listed = plan ? Math.round(Number(plan.price) * branches * (period === "year" ? 10 : 1) * 100) / 100 : 0;
  const net = subtotal.trim() ? Number(subtotal) : listed;
  const vat = Math.round(net * overview.vat_rate * 100) / 100;

  const reset = () => {
    setPlanId(overview.tenant.plan && overview.plans.some((p) => p.id === overview.tenant.plan!.id) ? overview.tenant.plan.id : "");
    setPeriod("month"); setBranches(overview.branches); setMethod("bank_transfer"); setReference(""); setSubtotal("");
    setPaidOn(new Date().toISOString().slice(0, 10)); setNote("");
  };
  useEffect(() => { if (open) reset(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useMutation({
    mutationFn: () => call<{ total: number; period_end: string | null; emailed: number }>({
      action: "record_offline", tenant_id: overview.tenant.id, plan_id: planId, period, branches, method, reference,
      ...(subtotal.trim() ? { subtotal: Number(subtotal) } : {}), paid_on: paidOn || undefined, note: note.trim() || undefined,
    }),
    onSuccess: (r) => {
      toast.success(`Recorded ${sar(r.total)}; paid until ${day(r.period_end)}${r.emailed ? ", invoice emailed" : ""}`);
      onOpenChange(false); onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Record an offline payment</DialogTitle>
          <DialogDescription>
            Only after the money has arrived. It is applied like an online payment: the paid-until date moves on, a tax invoice
            is issued and emailed to the owners.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>Plan</Label>
            <Select value={planId} onValueChange={setPlanId}>
              <SelectTrigger><SelectValue placeholder="Choose a plan" /></SelectTrigger>
              <SelectContent>{overview.plans.filter((p) => Number(p.price) > 0).map((p) => <SelectItem key={p.id} value={p.id}>{PLAN[p.name] ?? p.name} · {sar(p.price)}/branch/month</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Period</Label>
            <Select value={period} onValueChange={(v) => setPeriod(v as "month" | "year")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="month">1 month</SelectItem><SelectItem value="year">1 year (10 months' price)</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label htmlFor="op-br">Branches</Label><Input id="op-br" type="number" min={1} value={branches} onChange={(e) => setBranches(Math.max(1, Number(e.target.value) || 1))} /></div>
          <div className="space-y-1">
            <Label>Method</Label>
            <Select value={method} onValueChange={(v) => setMethod(v as typeof method)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="bank_transfer">Bank transfer</SelectItem><SelectItem value="cash">Cash</SelectItem><SelectItem value="other">Other</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label htmlFor="op-ref">Transfer reference</Label><Input id="op-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Bank reference or receipt no." /></div>
          <div className="space-y-1"><Label htmlFor="op-on">Received on</Label><Input id="op-on" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} /></div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="op-sub">Amount excl. VAT (SAR)</Label>
            <Input id="op-sub" type="number" min={1} step="0.01" value={subtotal} onChange={(e) => setSubtotal(e.target.value)} placeholder={plan ? `${listed.toFixed(2)} (list price)` : "Choose a plan"} />
            <p className="text-xs text-muted-foreground">Leave empty for the list price. Set it for an agreed price (e.g. Enterprise).</p>
          </div>
          <div className="space-y-1 sm:col-span-2"><Label htmlFor="op-note">Note (optional)</Label><Input id="op-note" value={note} onChange={(e) => setNote(e.target.value)} /></div>
        </div>
        {plan && (
          <div className="rounded-md border p-3 text-sm space-y-1">
            <div className="flex justify-between"><span>Subtotal</span><span className="tabular-nums">{sar(net)}</span></div>
            <div className="flex justify-between text-muted-foreground"><span>VAT {Math.round(overview.vat_rate * 100)}%</span><span className="tabular-nums">{sar(vat)}</span></div>
            <div className="flex justify-between font-semibold"><span>Total received</span><span className="tabular-nums">{sar(net + vat)}</span></div>
          </div>
        )}
        <DialogFooter>
          <Button onClick={() => save.mutate()} disabled={!planId || reference.trim().length < 2 || !(net >= 1) || save.isPending}>
            {save.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Record payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RefundDialog({ payment, onClose, tenantId, moyasarReady, onDone }: { payment: Payment | null; onClose: () => void; tenantId: string; moyasarReady: boolean; onDone: () => void }) {
  const left = payment ? Math.round((Number(payment.amount) - Number(payment.refunded_amount ?? 0)) * 100) / 100 : 0;
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [endPeriod, setEndPeriod] = useState(false);
  const [offline, setOffline] = useState(false);
  useEffect(() => { if (payment) { setAmount(String(left)); setReason(""); setEndPeriod(false); setOffline(false); } }, [payment, left]);
  const online = payment?.method === "moyasar" && !!payment.moyasar_invoice_id;
  const viaMoyasar = online && !offline;

  const save = useMutation({
    mutationFn: () => call<{ credit_note_number: string; emailed?: number }>({
      action: "refund", tenant_id: tenantId, payment_id: payment!.id, amount: Number(amount), reason, end_period: endPeriod, offline: !viaMoyasar,
    }),
    onSuccess: (r) => { toast.success(`Refund recorded, credit note ${r.credit_note_number}${r.emailed ? " emailed to the owners" : ""}`); onClose(); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={!!payment} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Refund {payment?.invoice_number}</DialogTitle>
          <DialogDescription>
            {viaMoyasar
              ? "The money goes back to the customer's card through Moyasar. This cannot be undone."
              : "Record a refund you have already paid back outside Matbex (e.g. by bank transfer)."}
            {" "}A credit note number is issued.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="rf-amt">Amount incl. VAT (SAR)</Label>
            <Input id="rf-amt" type="number" min={0.01} max={left} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <p className="text-xs text-muted-foreground">Up to {sar(left)} is left to refund.</p>
          </div>
          <div className="space-y-1"><Label htmlFor="rf-reason">Reason</Label><Textarea id="rf-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
          {payment?.kind !== "addon" && (
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={endPeriod} onCheckedChange={(v) => setEndPeriod(v === true)} />End the paid period now</label>
          )}
          {online && (
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={offline} onCheckedChange={(v) => setOffline(v === true)} />Already refunded outside Moyasar (record only)</label>
          )}
          {viaMoyasar && !moyasarReady && <p className="text-sm text-destructive">Matbex's Moyasar key is not set on this server, so online refunds are not possible here.</p>}
        </div>
        <DialogFooter>
          <Button variant="destructive" onClick={() => save.mutate()}
            disabled={!(Number(amount) > 0) || Number(amount) > left || reason.trim().length < 3 || (viaMoyasar && !moyasarReady) || save.isPending}>
            {save.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}{viaMoyasar ? `Refund ${sar(Number(amount) || 0)}` : "Record refund"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
