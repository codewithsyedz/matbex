/**
 * "Split bill" on the POS payment step (docs/plans/split-payments.md, phase 2a). Three ways:
 *
 * - By item: the cashier gives cart units to guests 1..N. Each guest then pays their part in
 *   turn (cash, card or other; a card is charged for exactly that guest's total). When the last
 *   guest has paid, all parts are recorded together (POST /api/v1/pos/sales/bill-split, or the
 *   offline queue) as one sale per guest, and the screen prints each guest's receipt in order.
 * - Evenly into N / by amount: one sale paid by N tenders (phase 1 split tender). The sheet hands
 *   the amounts to the screen's split-tender panel (onTenders) and can print a payment slip per
 *   guest showing their share.
 *
 * Used by the quick-sale dialog (SalesRecorder) and the POS pages (RecordSale, RecordSaleMobile).
 * Rules and rounding: src/lib/pos/billSplit.ts.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Banknote, CreditCard, Minus, Plus, Printer, Users, Wallet } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { roundMoney, sumMoney } from "@/lib/vatInclusive";
import { ApiError } from "@/lib/api/http";
import { quoteBillSplit, recordBillSplit, type BillSplitInput, type BillSplitResult, type CardTerminalApproval, type RecordSaleResult, type SaleTender } from "@/lib/api/pos";
import { recordOfflineSale } from "@/lib/offline/posService";
import { isOnline as isPosOnline } from "@/lib/offline/connectivity";
import {
  MAX_EVEN_GUESTS,
  MAX_GUESTS,
  assignAll,
  assignUnit,
  assignmentComplete,
  emptyAssignment,
  evenSplit,
  guestLines,
  localPartTotals,
  resizeAssignment,
  toSaleLine,
  unassignUnit,
  unassigned,
  type Assignment,
  type BillLine,
  type PartTotals,
} from "@/lib/pos/billSplit";

type Method = "cash" | "card" | "other";

/** One guest's recorded part, for the screen to print and stamp. */
export interface RecordedBillPart {
  index: number;
  count: number;
  receiptNumber: string;
  /** The recorded sale (null when queued offline). */
  transaction: RecordSaleResult["transaction"] | null;
  salesItems: RecordSaleResult["salesItems"];
  lines: BillLine[];
  totals: PartTotals;
  /** Printable tenders: amount, cash given and change. */
  payments: { method: Method; amount: number; tendered: number | null; change_given: number | null }[];
  offline: boolean;
}

export interface SplitBillSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lines: BillLine[];
  /** What the whole cart pays (VAT and document discount/surcharge included). */
  total: number;
  documentDiscount?: number;
  documentSurcharge?: number;
  vatRate: number;
  pricesInclusive: boolean;
  order: { restaurantId: string; branchId?: string | null; shiftId?: string | null; customerId?: string | null; tableId?: string | null };
  /** For the offline queue. */
  offline: { cashierId: string; branchName?: string | null };
  /** Charges a card for `amount` on the integrated terminal / gateway; null = standalone terminal. */
  chargeCard: ((amount: number, label: string) => Promise<CardTerminalApproval>) | null;
  /** Evenly / by amount: pay the one sale with these tenders (the screen's split panel). */
  onTenders: (amounts: number[]) => void;
  /** By item: every part is recorded; print and finish in guest order. */
  onRecorded: (parts: RecordedBillPart[]) => void;
  formatCurrency: (n: number) => string;
  restaurantName?: string;
  /**
   * Records the split instead of POST /pos/sales/bill-split (an open check pays through
   * /pos/checks/:id/pay). Such a bill is online only: it is never queued offline.
   */
  submit?: (input: BillSplitInput, opts: { idempotencyKey: string }) => Promise<BillSplitResult>;
}

interface GuestPayment {
  method: Method;
  tendered: string;
  approval: CardTerminalApproval | null;
  paid: boolean;
}

const newPayment = (): GuestPayment => ({ method: "cash", tendered: "", approval: null, paid: false });

/** Prints one slip per guest with their share of the bill (evenly / by amount). */
function printSlips(amounts: number[], fmt: (n: number) => string, title: string, guestLabel: (i: number) => string, restaurant?: string) {
  const w = window.open("", "_blank", "width=320,height=600");
  if (!w) return;
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const slips = amounts
    .map((a, i) => `<section><h2>${esc(restaurant ?? "")}</h2><p>${esc(title)}</p><p><b>${esc(guestLabel(i))}</b></p><p class="amt">${esc(fmt(a))}</p></section>`)
    .join("");
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    body{font-family:system-ui,sans-serif;margin:0;padding:8px;width:280px}
    section{border-bottom:1px dashed #000;padding:12px 0;page-break-after:always;text-align:center}
    h2{font-size:14px;margin:0 0 4px} p{margin:4px 0;font-size:13px} .amt{font-size:22px;font-weight:700}
  </style></head><body>${slips}</body></html>`);
  w.document.close();
  w.focus();
  w.print();
}

export function SplitBillSheet(props: SplitBillSheetProps) {
  const { t } = useTranslation();
  const { open, onOpenChange, lines, total, formatCurrency: fmt } = props;
  const [tab, setTab] = useState<"item" | "even" | "amount">("item");
  const [guests, setGuests] = useState(2);
  const [assignment, setAssignment] = useState<Assignment>(() => emptyAssignment(2));
  const [activeGuest, setActiveGuest] = useState(0);
  const [step, setStep] = useState<"assign" | "pay">("assign");
  const [totals, setTotals] = useState<PartTotals[] | null>(null);
  const [payments, setPayments] = useState<GuestPayment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [amounts, setAmounts] = useState<string[]>(["", ""]);
  // One key per split bill, reused on retry so a retried request never records it twice.
  const keyRef = useRef<string>(crypto.randomUUID());
  const recordingRef = useRef(false);

  const reset = () => {
    setTab("item");
    setGuests(2);
    setAssignment(emptyAssignment(2));
    setActiveGuest(0);
    setStep("assign");
    setTotals(null);
    setPayments([]);
    setBusy(false);
    setError(null);
    setAmounts(["", ""]);
    keyRef.current = crypto.randomUUID();
  };
  useEffect(() => {
    if (!open) reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const anyPaid = payments.some((p) => p.paid);
  const parts = useMemo(() => assignment.map((_, g) => guestLines(lines, assignment, g)), [lines, assignment]);
  const complete = assignmentComplete(lines, assignment);
  const even = useMemo(() => evenSplit(total, guests), [total, guests]);
  const typed = amounts.map((a) => roundMoney(parseFloat(a) || 0));
  const typedRemaining = roundMoney(roundMoney(total) - sumMoney(typed));
  const typedReady = typed.length >= 2 && typed.every((a) => a > 0) && Math.abs(typedRemaining) < 0.005;

  const setGuestCount = (n: number) => {
    const max = tab === "item" ? MAX_GUESTS : MAX_EVEN_GUESTS;
    const next = Math.min(max, Math.max(2, n));
    setGuests(next);
    setAssignment((a) => resizeAssignment(a, next));
    setActiveGuest((g) => Math.min(g, next - 1));
    setAmounts((prev) => (next > prev.length ? [...prev, ...Array(next - prev.length).fill("")] : prev.slice(0, next)));
  };

  const request = (withPayments: boolean): BillSplitInput => ({
    ...props.order,
    lines: lines.map(toSaleLine),
    documentDiscount: props.documentDiscount ?? 0,
    documentSurcharge: props.documentSurcharge ?? 0,
    parts: parts.map((p, i) => ({
      lines: p.map(toSaleLine),
      ...(withPayments ? { payments: [tenderOf(i)] } : {}),
    })),
  });

  const offlineNow = () => (typeof navigator !== "undefined" && navigator.onLine === false) || !isPosOnline();

  /** Guest totals: the server's quote online, the same arithmetic locally offline. */
  const goToPay = async () => {
    setError(null);
    setBusy(true);
    try {
      const local = localPartTotals(parts, {
        documentDiscount: props.documentDiscount,
        documentSurcharge: props.documentSurcharge,
        vatRate: props.vatRate,
        pricesInclusive: props.pricesInclusive,
      });
      let next = local;
      if (!offlineNow()) {
        try {
          next = (await quoteBillSplit(request(false))).parts;
        } catch (e) {
          if (e instanceof ApiError) throw e;
          // Network trouble: the bill can still be queued offline at the terminal's prices.
        }
      }
      setTotals(next);
      setPayments(next.map(newPayment));
      setStep("pay");
    } catch (e) {
      setError(e instanceof ApiError && e.code === "price_changed" ? t("app.pos.billSplit.pricesChanged") : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  function tenderOf(i: number): SaleTender {
    const p = payments[i];
    const amount = totals![i].total;
    return {
      method: p.method,
      amount,
      tendered: p.method === "cash" && p.tendered.trim() ? roundMoney(parseFloat(p.tendered) || 0) : null,
      cardTerminal: p.method === "card" ? p.approval : null,
    };
  }

  const patchPayment = (i: number, patch: Partial<GuestPayment>) =>
    setPayments((prev) => prev.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  const payGuest = async (i: number) => {
    const p = payments[i];
    const amount = totals![i].total;
    setError(null);
    if (p.method === "cash" && p.tendered.trim() && (parseFloat(p.tendered) || 0) < amount - 0.004) {
      setError(t("app.pos.billSplit.cashShort", { guest: i + 1 }));
      return;
    }
    if (p.method === "card" && props.chargeCard && !p.approval) {
      setBusy(true);
      try {
        const approval = await props.chargeCard(amount, t("app.pos.billSplit.guestN", { n: i + 1 }));
        patchPayment(i, { approval, paid: true });
      } catch (e) {
        setError(t("app.pos.billSplit.cardFailed", { guest: i + 1, message: e instanceof Error ? e.message : String(e) }));
      } finally {
        setBusy(false);
      }
      return;
    }
    patchPayment(i, { paid: true });
  };

  const printable = (i: number): RecordedBillPart["payments"] => {
    const tnd = tenderOf(i);
    return [{
      method: tnd.method,
      amount: tnd.amount,
      tendered: tnd.tendered ?? null,
      change_given: tnd.tendered != null ? roundMoney(tnd.tendered - tnd.amount) : null,
    }];
  };

  const record = async () => {
    if (recordingRef.current || !totals) return;
    recordingRef.current = true;
    setBusy(true);
    setError(null);
    const online = payments.some((p) => p.approval?.provider === "moyasar");
    const queue = async (): Promise<RecordedBillPart[]> => {
      if (online || props.submit) throw new Error(t("app.pos.billSplit.onlineCardOffline"));
      const res = await recordOfflineSale({
        branchId: props.order.restaurantId,
        saleBranchId: props.order.branchId ?? null,
        idempotencyKey: keyRef.current,
        cashierId: props.offline.cashierId,
        shiftId: props.order.shiftId ?? null,
        customerId: props.order.customerId ?? null,
        paymentMethod: "split",
        vatRate: props.vatRate,
        pricesVatInclusive: props.pricesInclusive,
        branchName: props.offline.branchName ?? null,
        documentDiscount: props.documentDiscount ?? 0,
        documentSurcharge: props.documentSurcharge ?? 0,
        items: lines.map((l) => ({ menu_item_id: l.comboId ?? l.menuItemId!, combo_id: l.comboId ?? null, name: l.name, size: l.size, quantity: l.quantity, unit_price: l.unitPrice })),
        billParts: parts.map((p, i) => ({
          total: totals[i].total,
          items: p.map((l) => ({ menu_item_id: l.comboId ?? l.menuItemId!, combo_id: l.comboId ?? null, name: l.name, size: l.size, quantity: l.quantity, unit_price: l.unitPrice })),
          payments: [tenderOf(i)].map((tn) => ({
            method: tn.method,
            amount: tn.amount,
            tendered: tn.tendered ?? null,
            cardTerminal: tn.cardTerminal?.provider === "hala" ? { ...tn.cardTerminal, provider: "hala" as const } : null,
          })),
        })),
      });
      return parts.map((p, i) => ({
        index: i + 1, count: parts.length, receiptNumber: res.receiptNumbers![i], transaction: null, salesItems: [],
        lines: p, totals: totals[i], payments: printable(i), offline: true,
      }));
    };
    try {
      let recorded: RecordedBillPart[];
      if (offlineNow()) recorded = await queue();
      else {
        try {
          const res = await (props.submit ?? recordBillSplit)(request(true), { idempotencyKey: keyRef.current });
          recorded = res.sales.map((s, i) => ({
            index: s.billPart.index, count: s.billPart.count, receiptNumber: s.receiptNumber, transaction: s.transaction,
            salesItems: s.salesItems, lines: parts[i],
            totals: { subtotal: s.transaction.subtotal, tax: s.transaction.tax, total: s.transaction.total, documentDiscount: totals[i].documentDiscount, documentSurcharge: totals[i].documentSurcharge },
            payments: printable(i), offline: false,
          }));
        } catch (e) {
          if (e instanceof ApiError) throw e;
          recorded = await queue();
        }
      }
      props.onRecorded(recorded);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof ApiError && e.code === "price_changed" ? t("app.pos.billSplit.pricesChanged") : e instanceof Error ? e.message : String(e));
    } finally {
      recordingRef.current = false;
      setBusy(false);
    }
  };

  // The last guest paid: record every part.
  useEffect(() => {
    if (step === "pay" && payments.length && payments.every((p) => p.paid) && !error) void record();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payments, step]);

  const guestTabs = (
    <div className="flex items-center gap-2">
      <Users className="h-4 w-4 text-muted-foreground" />
      <span className="text-sm">{t("app.pos.billSplit.guests")}</span>
      <Button variant="outline" size="icon" className="h-8 w-8" aria-label={t("app.pos.billSplit.fewerGuests")} disabled={guests <= 2 || anyPaid} onClick={() => setGuestCount(guests - 1)}>
        <Minus className="h-3.5 w-3.5" />
      </Button>
      <span className="w-6 text-center font-semibold" aria-live="polite">{guests}</span>
      <Button
        variant="outline"
        size="icon"
        className="h-8 w-8"
        aria-label={t("app.pos.billSplit.moreGuests")}
        disabled={guests >= (tab === "item" ? MAX_GUESTS : MAX_EVEN_GUESTS) || anyPaid}
        onClick={() => setGuestCount(guests + 1)}
      >
        <Plus className="h-3.5 w-3.5" />
      </Button>
    </div>
  );

  const methodButtons = (i: number, p: GuestPayment) => (
    <div className="grid grid-cols-3 gap-1">
      {(["cash", "card", "other"] as const).map((m) => (
        <Button
          key={m}
          size="sm"
          variant={p.method === m ? "default" : "outline"}
          className="h-8 gap-1 text-xs"
          disabled={p.paid || busy}
          onClick={() => patchPayment(i, { method: m, tendered: "" })}
        >
          {m === "cash" ? <Banknote className="h-3.5 w-3.5" /> : m === "card" ? <CreditCard className="h-3.5 w-3.5" /> : <Wallet className="h-3.5 w-3.5" />}
          {t(`app.sales.paymentMethods.${m}`)}
        </Button>
      ))}
    </div>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        // A guest's card is already charged: keep the sheet until the bill is recorded.
        if (!o && (busy || payments.some((p) => p.approval))) return;
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>{t("app.pos.billSplit.title")}</DialogTitle>
          <DialogDescription>{t("app.pos.billSplit.total", { total: fmt(total) })}</DialogDescription>
        </DialogHeader>
        <Tabs value={tab} onValueChange={(v) => {
            if (anyPaid || step !== "assign") return;
            setTab(v as typeof tab);
            if (v !== "item" && guests > MAX_EVEN_GUESTS) setGuestCount(MAX_EVEN_GUESTS);
          }} className="flex min-h-0 flex-1 flex-col">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="item" disabled={step === "pay"}>{t("app.pos.billSplit.byItem")}</TabsTrigger>
            <TabsTrigger value="even" disabled={step === "pay"}>{t("app.pos.billSplit.evenly")}</TabsTrigger>
            <TabsTrigger value="amount" disabled={step === "pay"}>{t("app.pos.billSplit.byAmount")}</TabsTrigger>
          </TabsList>

          {/* ── By item ───────────────────────────────────────────── */}
          <TabsContent value="item" className="min-h-0 flex-1 space-y-3 overflow-hidden data-[state=active]:flex data-[state=active]:flex-col">
            {step === "assign" ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {guestTabs}
                  <p className="text-xs text-muted-foreground">{t("app.pos.billSplit.byItemHelp")}</p>
                </div>
                <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={t("app.pos.billSplit.guests")}>
                  {assignment.map((_, g) => (
                    <Button key={g} size="sm" variant={g === activeGuest ? "default" : "outline"} className="h-8 text-xs" role="tab" aria-selected={g === activeGuest} onClick={() => setActiveGuest(g)}>
                      {t("app.pos.billSplit.guestN", { n: g + 1 })}
                      <Badge variant="secondary" className="ms-1.5 text-[10px]">{parts[g].reduce((s, l) => s + l.quantity, 0)}</Badge>
                    </Button>
                  ))}
                </div>
                <ScrollArea className="min-h-0 flex-1 rounded-md border">
                  <ul className="divide-y">
                    {lines.map((l) => {
                      const left = unassigned(l, assignment);
                      return (
                        <li key={l.key} className="flex flex-wrap items-center gap-2 p-2">
                          <button
                            type="button"
                            className={cn("flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-1 text-start", left > 0 ? "hover:bg-muted" : "opacity-60")}
                            disabled={left <= 0}
                            onClick={() => setAssignment((a) => assignUnit(a, l, activeGuest))}
                            aria-label={t("app.pos.billSplit.giveOne", { item: l.name, guest: activeGuest + 1 })}
                          >
                            <span className="min-w-0 flex-1 truncate text-sm">
                              {l.name}
                              {l.size !== "regular" ? <span className="text-muted-foreground"> · {l.size}</span> : null}
                            </span>
                            <span className="text-xs text-muted-foreground">{fmt(l.unitPrice)}</span>
                            <Badge variant={left > 0 ? "destructive" : "secondary"} className="text-[10px]">
                              {t("app.pos.billSplit.left", { n: left })}
                            </Badge>
                          </button>
                          {left > 1 && (
                            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setAssignment((a) => assignAll(a, l, activeGuest))}>
                              {t("app.pos.billSplit.giveAll", { guest: activeGuest + 1 })}
                            </Button>
                          )}
                          <div className="flex w-full flex-wrap gap-1">
                            {assignment.map((g, gi) =>
                              g[l.key] > 0 ? (
                                <button
                                  key={gi}
                                  type="button"
                                  className="rounded-full border px-2 py-0.5 text-[11px] hover:bg-muted"
                                  onClick={() => setAssignment((a) => unassignUnit(a, l, gi))}
                                  aria-label={t("app.pos.billSplit.takeBack", { item: l.name, guest: gi + 1 })}
                                >
                                  {t("app.pos.billSplit.guestShort", { n: gi + 1 })} × {g[l.key]} ✕
                                </button>
                              ) : null,
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </ScrollArea>
                <Button className="w-full" disabled={!complete || busy} onClick={() => void goToPay()}>
                  {complete ? t("app.pos.billSplit.toPayment") : t("app.pos.billSplit.assignAll")}
                </Button>
              </>
            ) : (
              <ScrollArea className="min-h-0 flex-1">
                <div className="space-y-2 pe-2">
                  <p className="text-xs text-muted-foreground">{t("app.pos.billSplit.payHelp")}</p>
                  {totals?.map((tot, i) => {
                    const p = payments[i];
                    const change = p.method === "cash" && p.tendered.trim() ? roundMoney((parseFloat(p.tendered) || 0) - tot.total) : null;
                    const next = payments.findIndex((x) => !x.paid);
                    return (
                      <div key={i} className={cn("space-y-2 rounded-lg border p-3", i === next && "border-primary")}>
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold">{t("app.pos.billSplit.guestN", { n: i + 1 })}</p>
                            <p className="truncate text-xs text-muted-foreground">{parts[i].map((l) => `${l.quantity}× ${l.name}`).join(", ")}</p>
                          </div>
                          <div className="text-end">
                            <p className="font-semibold">{fmt(tot.total)}</p>
                            {tot.documentDiscount > 0 && <p className="text-[11px] text-muted-foreground">{t("app.pos.billSplit.discountShare", { amount: fmt(tot.documentDiscount) })}</p>}
                          </div>
                        </div>
                        {p.paid ? (
                          <Badge variant="secondary">{t("app.pos.billSplit.paidBy", { method: t(`app.sales.paymentMethods.${p.method}`) })}</Badge>
                        ) : (
                          <>
                            {methodButtons(i, p)}
                            {p.method === "cash" && (
                              <div className="flex items-center gap-2">
                                <Input
                                  type="number"
                                  inputMode="decimal"
                                  min={0}
                                  step="0.01"
                                  className="h-8 text-xs"
                                  placeholder={t("app.pos.recorder.tendered")}
                                  aria-label={t("app.pos.recorder.tendered")}
                                  value={p.tendered}
                                  onChange={(e) => patchPayment(i, { tendered: e.target.value })}
                                />
                                {change != null && (
                                  <span className={cn("whitespace-nowrap text-xs", change < 0 ? "text-destructive" : "text-muted-foreground")}>
                                    {t("app.pos.recorder.change")}: {fmt(Math.max(0, change))}
                                  </span>
                                )}
                              </div>
                            )}
                            <Button size="sm" className="w-full" disabled={busy || i !== next} onClick={() => void payGuest(i)}>
                              {p.method === "card" && props.chargeCard ? t("app.pos.billSplit.chargeGuest", { n: i + 1, amount: fmt(tot.total) }) : t("app.pos.billSplit.takePayment", { n: i + 1, amount: fmt(tot.total) })}
                            </Button>
                          </>
                        )}
                      </div>
                    );
                  })}
                  {payments.length > 0 && payments.every((p) => p.paid) && (
                    <Button className="w-full" disabled={busy} onClick={() => void record()}>
                      {busy ? t("app.pos.billSplit.recording") : t("app.pos.billSplit.retryRecord")}
                    </Button>
                  )}
                  {!anyPaid && (
                    <Button variant="ghost" size="sm" className="w-full" disabled={busy} onClick={() => setStep("assign")}>
                      {t("app.pos.billSplit.backToItems")}
                    </Button>
                  )}
                </div>
              </ScrollArea>
            )}
          </TabsContent>

          {/* ── Evenly ────────────────────────────────────────────── */}
          <TabsContent value="even" className="space-y-3">
            {guestTabs}
            <p className="text-xs text-muted-foreground">{t("app.pos.billSplit.evenHelp")}</p>
            <ul className="divide-y rounded-md border">
              {even.map((a, i) => (
                <li key={i} className="flex items-center justify-between p-2 text-sm">
                  <span>{t("app.pos.billSplit.guestN", { n: i + 1 })}</span>
                  <span className="font-semibold">{fmt(a)}</span>
                </li>
              ))}
            </ul>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" className="gap-1" onClick={() => printSlips(even, fmt, t("app.pos.billSplit.slipTitle"), (i) => t("app.pos.billSplit.guestOf", { n: i + 1, count: even.length }), props.restaurantName)}>
                <Printer className="h-4 w-4" />
                {t("app.pos.billSplit.printSlips")}
              </Button>
              <Button onClick={() => { props.onTenders(even); onOpenChange(false); }}>{t("app.pos.billSplit.payInParts", { n: even.length })}</Button>
            </div>
          </TabsContent>

          {/* ── By amount ─────────────────────────────────────────── */}
          <TabsContent value="amount" className="space-y-3">
            {guestTabs}
            <p className="text-xs text-muted-foreground">{t("app.pos.billSplit.amountHelp")}</p>
            <div className="space-y-1.5">
              {amounts.map((v, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-20 shrink-0 text-sm">{t("app.pos.billSplit.guestN", { n: i + 1 })}</span>
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    className="h-8"
                    aria-label={t("app.pos.billSplit.guestN", { n: i + 1 })}
                    value={v}
                    onChange={(e) => setAmounts((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))}
                  />
                  {i === amounts.length - 1 && typedRemaining > 0 && (
                    <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setAmounts((prev) => prev.map((x, j) => (j === i ? roundMoney((parseFloat(x) || 0) + typedRemaining).toFixed(2) : x)))}>
                      {t("app.pos.billSplit.addRest")}
                    </Button>
                  )}
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{t("app.pos.recorder.remaining")}</span>
              <span className={cn("font-semibold", Math.abs(typedRemaining) >= 0.005 && "text-destructive")}>{fmt(typedRemaining)}</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" className="gap-1" disabled={!typedReady} onClick={() => printSlips(typed, fmt, t("app.pos.billSplit.slipTitle"), (i) => t("app.pos.billSplit.guestOf", { n: i + 1, count: typed.length }), props.restaurantName)}>
                <Printer className="h-4 w-4" />
                {t("app.pos.billSplit.printSlips")}
              </Button>
              <Button disabled={!typedReady} onClick={() => { props.onTenders(typed); onOpenChange(false); }}>{t("app.pos.billSplit.payInParts", { n: typed.length })}</Button>
            </div>
          </TabsContent>
        </Tabs>
        {error && <p role="alert" className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
