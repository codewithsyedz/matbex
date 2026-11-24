/**
 * Open checks / running tabs on the POS (docs/plans/open-checks.md, phase 2b.1).
 *
 * - List: the branch's open checks, live (pos_checks changes over the event channel).
 * - Add the POS cart to a check (existing or new, on a table or with a name), optionally
 *   sending it to the kitchen at once ("Send to kitchen").
 * - A check: its lines by round; unsent lines can change or be removed; "Send to kitchen";
 *   void a check nothing of which was sent; "Pay".
 * - Pay: cash / card / other, split payment, or split bill by guest (SplitBillSheet), all
 *   through POST /api/v1/pos/checks/:id/pay, which records ordinary sales.
 *
 * Checks live on the server: offline, the sheet says so and changes nothing.
 * Used by /record-sale (RecordSale, RecordSaleMobile).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { ArrowLeft, Banknote, ChefHat, CreditCard, Minus, Plus, Receipt, SplitSquareHorizontal, Trash2, Users, Wallet } from "lucide-react";
import { toast } from "sonner";
import { db } from "@/integrations/db/client";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { ApiError } from "@/lib/api/http";
import type { CardTerminalApproval, RecordSaleResult, SaleTender } from "@/lib/api/pos";
import {
  addCheckLines, checkSaleLine, editCheckLine, getCheck, listOpenChecks, openCheck, payCheck, sendCheck, voidCheck, voidCheckLine,
  type CheckDetail, type CheckLineInput, type CheckSummary,
} from "@/lib/api/checks";
import { isOnline as isPosOnline } from "@/lib/offline/connectivity";
import { useTableChanges } from "@/hooks/useTableChanges";
import { SplitTenderPanel } from "@/components/pos/SplitTenderPanel";
import { SplitBillSheet } from "@/components/pos/SplitBillSheet";
import { chargeCardTenders, splitIsComplete, tenderParts, toSalePayments, useSplitTenders } from "@/lib/pos/splitTenders";
import { roundMoney } from "@/lib/vatInclusive";

/** A POS cart line to put on a check. */
export interface CartLineForCheck {
  name: string;
  line: CheckLineInput;
}

/** One sale that paid (part of) a check, for the screen's receipt and invoice. */
export interface PaidCheckPart {
  receiptNumber: string;
  transaction: RecordSaleResult["transaction"];
  salesItems: RecordSaleResult["salesItems"];
  /** The check lines this sale charged (quantities of this part). */
  lines: CheckDetail["lines"];
  /** Printable tenders: amount, cash given, change. */
  payments: { method: "cash" | "card" | "other"; amount: number; tendered: number | null; change_given: number | null }[];
  documentDiscount: number;
  documentSurcharge: number;
}

export interface OpenChecksSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  restaurantId: string;
  branchId: string | null;
  shiftId: string | null;
  vatRate: number;
  pricesInclusive: boolean;
  /** Cart lines to add to a check (from the POS "Send to kitchen" button); empty = browse. */
  cart: CartLineForCheck[];
  /** The cart went onto a check: clear it. */
  onCartAdded: () => void;
  /** Open the check of this table, or start a new one for it (floor plan → POS). */
  tableId?: string | null;
  /** Charges a card on the integrated gateway for `amount`; null = standalone terminal. */
  chargeCard: ((amount: number) => Promise<CardTerminalApproval>) | null;
  /** The check was paid: print / stamp each sale, in order (one, or one per guest). */
  onPaid: (parts: PaidCheckPart[], check: CheckDetail) => void;
  formatCurrency: (n: number) => string;
  restaurantName?: string;
}

type View = { kind: "list" } | { kind: "new" } | { kind: "check"; id: string } | { kind: "pay"; id: string };

const offlineNow = () => (typeof navigator !== "undefined" && navigator.onLine === false) || !isPosOnline();

function errorText(e: unknown, t: (k: string) => string) {
  if (e instanceof ApiError) {
    if (e.code === "check_changed") return t("app.pos.checks.errors.changed");
    if (e.code === "price_changed") return t("app.pos.checks.errors.priceChanged");
    if (e.code === "table_has_open_check") return t("app.pos.checks.errors.tableBusy");
    if (e.code === "line_sent" || e.code === "check_sent") return t("app.pos.checks.errors.sent");
  }
  return e instanceof Error ? e.message : String(e);
}

export function OpenChecksSheet(props: OpenChecksSheetProps) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { open, onOpenChange, restaurantId, branchId, formatCurrency: fmt } = props;
  const [view, setView] = useState<View>({ kind: "list" });
  const [busy, setBusy] = useState(false);
  const [sendNow, setSendNow] = useState(true);
  const [newTable, setNewTable] = useState<string>("");
  const [newName, setNewName] = useState("");
  const [newGuests, setNewGuests] = useState("");
  const adding = props.cart.length > 0;
  const offline = offlineNow();

  const listKey = ["pos-open-checks", restaurantId, branchId];
  const { data: checks = [], isLoading } = useQuery({
    queryKey: listKey,
    queryFn: () => listOpenChecks(restaurantId, branchId),
    enabled: open && !!restaurantId && !offline,
    refetchInterval: open ? 30_000 : false,
  });
  const checkId = view.kind === "check" || view.kind === "pay" ? view.id : null;
  const { data: check, refetch: refetchCheck } = useQuery({
    queryKey: ["pos-check", restaurantId, checkId],
    queryFn: () => getCheck(checkId!, restaurantId),
    enabled: open && !!checkId && !offline,
  });
  useTableChanges({
    topic: "pos",
    restaurantId,
    branchId,
    tables: ["pos_checks"],
    enabled: open,
    onChange: () => {
      void qc.invalidateQueries({ queryKey: ["pos-open-checks", restaurantId] });
      void qc.invalidateQueries({ queryKey: ["pos-check", restaurantId] });
    },
  });

  const { data: tables = [] } = useQuery({
    queryKey: ["pos-tables-for-checks", restaurantId, branchId],
    enabled: open && view.kind === "new",
    queryFn: async () => {
      let q = db.from("pos_tables").select("id, label, status, branch_id").eq("restaurant_id", restaurantId).is("deleted_at", null).order("label");
      if (branchId) q = q.eq("branch_id", branchId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as { id: string; label: string; status: string }[];
    },
  });
  const busyTables = useMemo(() => new Set(checks.map((c) => c.tableId).filter(Boolean)), [checks]);

  // Opened from the floor plan for a table: its open check, else a new one on it.
  const handledTable = useRef<string | null>(null);
  useEffect(() => {
    if (!open) {
      setView({ kind: "list" });
      handledTable.current = null;
      return;
    }
    if (!props.tableId || isLoading || handledTable.current === props.tableId) return;
    handledTable.current = props.tableId;
    const existing = checks.find((c) => c.tableId === props.tableId);
    if (existing) setView({ kind: "check", id: existing.id });
    else {
      setNewTable(props.tableId);
      setView({ kind: "new" });
    }
  }, [open, props.tableId, isLoading, checks]);

  const refresh = (c?: CheckDetail) => {
    if (c) qc.setQueryData(["pos-check", restaurantId, c.id], c);
    void qc.invalidateQueries({ queryKey: ["pos-open-checks", restaurantId] });
  };

  const run = async (fn: () => Promise<void>) => {
    if (offline) return toast.error(t("app.pos.checks.offline"));
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast.error(errorText(e, t));
      if (e instanceof ApiError && e.code === "check_changed") void refetchCheck();
    } finally {
      setBusy(false);
    }
  };

  const addCartTo = (c: CheckSummary) =>
    run(async () => {
      const updated = await addCheckLines(c.id, { restaurantId, expectedVersion: c.version, lines: props.cart.map((x) => x.line), send: sendNow });
      props.onCartAdded();
      refresh(updated);
      toast.success(sendNow ? t("app.pos.checks.sentTo", { check: label(updated) }) : t("app.pos.checks.addedTo", { check: label(updated) }));
      setView({ kind: "check", id: updated.id });
    });

  const createCheck = () =>
    run(async () => {
      const created = await openCheck({
        restaurantId,
        branchId,
        tableId: newTable || null,
        name: newTable ? null : newName.trim() || null,
        guestCount: parseInt(newGuests, 10) || null,
        lines: adding ? props.cart.map((x) => x.line) : [],
        send: adding && sendNow,
      });
      if (adding) props.onCartAdded();
      refresh(created);
      setNewName("");
      setNewGuests("");
      setNewTable("");
      toast.success(t("app.pos.checks.opened", { check: label(created) }));
      setView({ kind: "check", id: created.id });
    });

  const label = (c: Pick<CheckSummary, "tableLabel" | "name" | "checkNumber">) =>
    c.tableLabel ? t("app.pos.checks.table", { label: c.tableLabel }) : c.name || c.checkNumber;

  // ---------------------------------------------------------------------------------------
  const header = (
    <SheetHeader>
      <SheetTitle className="flex items-center gap-2">
        {view.kind !== "list" && (
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={t("app.pos.checks.back")} onClick={() => setView(view.kind === "pay" ? { kind: "check", id: view.id } : { kind: "list" })}>
            <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
          </Button>
        )}
        {view.kind === "list" ? t("app.pos.checks.title") : view.kind === "new" ? t("app.pos.checks.newCheck") : check ? label(check) : t("app.pos.checks.title")}
      </SheetTitle>
      <SheetDescription>
        {adding && view.kind !== "pay" ? t("app.pos.checks.addingCart", { count: props.cart.reduce((s, x) => s + x.line.quantity, 0) }) : offline ? t("app.pos.checks.offline") : t("app.pos.checks.help")}
      </SheetDescription>
    </SheetHeader>
  );

  return (
    <Sheet open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <SheetContent className="flex w-full flex-col gap-3 sm:max-w-md">
        {header}
        {view.kind === "list" && (
          <>
            {adding && (
              <label className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm">
                {t("app.pos.checks.sendNow")}
                <Switch checked={sendNow} onCheckedChange={setSendNow} />
              </label>
            )}
            <Button className="w-full gap-1.5" disabled={busy || offline} onClick={() => setView({ kind: "new" })}>
              <Plus className="h-4 w-4" />
              {t("app.pos.checks.newCheck")}
            </Button>
            <ScrollArea className="min-h-0 flex-1">
              <ul className="space-y-2 pe-2">
                {checks.length === 0 && !isLoading && <li className="py-8 text-center text-sm text-muted-foreground">{t("app.pos.checks.none")}</li>}
                {checks.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => (adding ? void addCartTo(c) : setView({ kind: "check", id: c.id }))}
                      className="w-full rounded-lg border p-3 text-start hover:bg-muted disabled:opacity-50"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold">{label(c)}</span>
                        <span className="font-semibold tabular-nums">{fmt(c.total)}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        <span className="font-mono">{c.checkNumber}</span>
                        <span>· {t("app.pos.checks.items", { count: c.itemCount })}</span>
                        <span>· {formatDistanceToNow(new Date(c.openedAt))}</span>
                        {c.unsentCount > 0 && <Badge variant="destructive" className="px-1 py-0 text-[10px]">{t("app.pos.checks.unsent", { count: c.unsentCount })}</Badge>}
                        {adding && <Badge variant="secondary" className="px-1 py-0 text-[10px]">{sendNow ? t("app.pos.checks.tapToSend") : t("app.pos.checks.tapToAdd")}</Badge>}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </ScrollArea>
          </>
        )}

        {view.kind === "new" && (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>{t("app.pos.checks.tableLabel")}</Label>
              <Select value={newTable || "none"} onValueChange={(v) => setNewTable(v === "none" ? "" : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("app.pos.checks.noTable")}</SelectItem>
                  {tables.map((tb) => (
                    <SelectItem key={tb.id} value={tb.id} disabled={busyTables.has(tb.id)}>
                      {t("app.pos.checks.table", { label: tb.label })}{busyTables.has(tb.id) ? ` · ${t("app.pos.checks.busy")}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {!newTable && (
              <div className="space-y-1">
                <Label htmlFor="check-name">{t("app.pos.checks.name")}</Label>
                <Input id="check-name" value={newName} maxLength={80} placeholder={t("app.pos.checks.namePlaceholder")} onChange={(e) => setNewName(e.target.value)} />
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor="check-guests">{t("app.pos.checks.guests")}</Label>
              <Input id="check-guests" type="number" inputMode="numeric" min={1} value={newGuests} onChange={(e) => setNewGuests(e.target.value)} />
            </div>
            {adding && (
              <label className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm">
                {t("app.pos.checks.sendNow")}
                <Switch checked={sendNow} onCheckedChange={setSendNow} />
              </label>
            )}
            <Button className="w-full" disabled={busy || offline || (!newTable && !newName.trim())} onClick={() => void createCheck()}>
              {adding && sendNow ? t("app.pos.checks.openAndSend") : t("app.pos.checks.open")}
            </Button>
          </div>
        )}

        {view.kind === "check" && check && (
          <CheckView
            check={check}
            busy={busy || offline}
            fmt={fmt}
            onSend={() => run(async () => { const c = await sendCheck(check.id, { restaurantId, expectedVersion: check.version }); refresh(c); toast.success(t("app.pos.checks.sent")); })}
            onQty={(lineId, quantity) => run(async () => refresh(await editCheckLine(check.id, lineId, { restaurantId, expectedVersion: check.version, quantity })))}
            onRemove={(lineId) => run(async () => refresh(await voidCheckLine(check.id, lineId, { restaurantId, expectedVersion: check.version })))}
            onVoid={() => run(async () => { await voidCheck(check.id, { restaurantId, expectedVersion: check.version }); refresh(); setView({ kind: "list" }); })}
            onPay={() => setView({ kind: "pay", id: check.id })}
          />
        )}

        {view.kind === "pay" && check && (
          <PayView {...props} check={check} offline={offline} onDone={(parts) => { refresh(); props.onPaid(parts, check); onOpenChange(false); }} onChanged={() => void refetchCheck()} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function CheckView({ check, busy, fmt, onSend, onQty, onRemove, onVoid, onPay }: {
  check: CheckDetail;
  busy: boolean;
  fmt: (n: number) => string;
  onSend: () => void;
  onQty: (lineId: string, quantity: number) => void;
  onRemove: (lineId: string) => void;
  onVoid: () => void;
  onPay: () => void;
}) {
  const { t } = useTranslation();
  const active = check.lines.filter((l) => l.status === "active");
  const unsent = active.filter((l) => l.roundNumber == null);
  const rounds = [...new Set(active.flatMap((l) => (l.roundNumber != null ? [l.roundNumber] : [])))].sort((a, b) => a - b);
  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <span className="font-mono">{check.checkNumber}</span>
        {check.guestCount ? <span>· <Users className="inline h-3 w-3" /> {check.guestCount}</span> : null}
        <span>· {formatDistanceToNow(new Date(check.openedAt), { addSuffix: true })}</span>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-3 pe-2">
          {unsent.length > 0 && (
            <section>
              <p className="mb-1 text-xs font-semibold uppercase text-destructive">{t("app.pos.checks.notSent")}</p>
              <ul className="divide-y rounded-md border">
                {unsent.map((l) => (
                  <li key={l.id} className="flex items-center gap-2 p-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">{l.name}{l.note ? <span className="text-muted-foreground"> · {l.note}</span> : null}</span>
                    <Button variant="outline" size="icon" className="h-7 w-7" aria-label={t("app.pos.checks.less")} disabled={busy || l.quantity <= 1} onClick={() => onQty(l.id, l.quantity - 1)}><Minus className="h-3 w-3" /></Button>
                    <span className="w-6 text-center tabular-nums">{l.quantity}</span>
                    <Button variant="outline" size="icon" className="h-7 w-7" aria-label={t("app.pos.checks.more")} disabled={busy} onClick={() => onQty(l.id, l.quantity + 1)}><Plus className="h-3 w-3" /></Button>
                    <span className="w-16 text-end tabular-nums">{fmt(l.lineTotal)}</span>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" aria-label={t("app.pos.checks.remove")} disabled={busy} onClick={() => onRemove(l.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {rounds.map((n) => (
            <section key={n}>
              <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">{t("app.pos.checks.round", { n })}</p>
              <ul className="divide-y rounded-md border">
                {active.filter((l) => l.roundNumber === n).map((l) => (
                  <li key={l.id} className="flex items-center gap-2 p-2 text-sm">
                    <span className="w-6 text-center tabular-nums">{l.quantity}×</span>
                    <span className="min-w-0 flex-1 truncate">{l.name}{l.note ? <span className="text-muted-foreground"> · {l.note}</span> : null}</span>
                    <span className="tabular-nums">{fmt(l.lineTotal)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {active.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">{t("app.pos.checks.empty")}</p>}
        </div>
      </ScrollArea>
      <div className="space-y-1 border-t pt-2 text-sm">
        <div className="flex justify-between text-muted-foreground"><span>{t("app.pos.checks.vat")}</span><span className="tabular-nums">{fmt(check.tax)}</span></div>
        <div className="flex justify-between text-base font-semibold"><span>{t("app.pos.checks.total")}</span><span className="tabular-nums">{fmt(check.total)}</span></div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" className="gap-1.5" disabled={busy || unsent.length === 0} onClick={onSend}>
          <ChefHat className="h-4 w-4" />
          {t("app.pos.checks.send")}
        </Button>
        <Button className="gap-1.5" disabled={busy || active.length === 0} onClick={onPay}>
          <Receipt className="h-4 w-4" />
          {t("app.pos.checks.pay", { total: fmt(check.total) })}
        </Button>
      </div>
      {check.rounds.length === 0 && (
        <Button variant="ghost" size="sm" className="text-destructive" disabled={busy} onClick={onVoid}>
          {t("app.pos.checks.voidCheck")}
        </Button>
      )}
    </>
  );
}

function PayView(props: OpenChecksSheetProps & {
  check: CheckDetail;
  offline: boolean;
  onDone: (parts: PaidCheckPart[], check: CheckDetail) => void;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const { check, restaurantId, formatCurrency: fmt } = props;
  const [method, setMethod] = useState<"cash" | "card" | "other" | "split">("cash");
  const [tendered, setTendered] = useState("");
  const [busy, setBusy] = useState(false);
  const [billOpen, setBillOpen] = useState(false);
  const split = useSplitTenders(check.total);
  const keyRef = useRef(crypto.randomUUID());
  const cardRef = useRef<CardTerminalApproval | null>(null);
  const active = check.lines.filter((l) => l.status === "active");
  const change = method === "cash" && tendered.trim() ? roundMoney((parseFloat(tendered) || 0) - check.total) : null;

  const pay = async () => {
    if (props.offline) return toast.error(t("app.pos.checks.offline"));
    setBusy(true);
    try {
      let payments: SaleTender[];
      if (method === "split") {
        if (!splitIsComplete(split.tenders, check.total)) throw new Error(t("app.pos.recorder.splitIncomplete"));
        const parts = tenderParts(split.tenders);
        if (props.chargeCard) await chargeCardTenders(parts, (amount) => props.chargeCard!(amount), split.markApproved);
        payments = toSalePayments(parts);
      } else {
        if (method === "cash" && tendered.trim() && (parseFloat(tendered) || 0) < check.total - 0.004) throw new Error(t("app.pos.checks.cashShort"));
        let cardTerminal: CardTerminalApproval | null = null;
        if (method === "card" && props.chargeCard) {
          cardTerminal = cardRef.current ?? (await props.chargeCard(check.total));
          cardRef.current = cardTerminal;
        }
        payments = [{ method, amount: check.total, tendered: method === "cash" && tendered.trim() ? roundMoney(parseFloat(tendered) || 0) : null, cardTerminal }];
      }
      const res = await payCheck(check.id, { restaurantId, expectedVersion: check.version, shiftId: props.shiftId, payments }, { idempotencyKey: keyRef.current });
      const sale = res.sales[0];
      props.onDone([{
        receiptNumber: sale.receiptNumber,
        transaction: sale.transaction,
        salesItems: sale.salesItems,
        lines: active,
        payments: payments.map((p) => ({
          method: p.method,
          amount: p.amount,
          tendered: p.tendered ?? null,
          change_given: p.tendered != null ? roundMoney(p.tendered - p.amount) : null,
        })),
        documentDiscount: 0,
        documentSurcharge: 0,
      }], check);
    } catch (e) {
      toast.error(errorText(e, t));
      if (e instanceof ApiError && e.code === "check_changed") props.onChanged();
    } finally {
      setBusy(false);
    }
  };

  const methodButton = (m: typeof method, icon: React.ReactNode, text: string) => (
    <Button variant={method === m ? "default" : "outline"} className="gap-1.5" disabled={busy} onClick={() => setMethod(m)}>
      {icon}
      {text}
    </Button>
  );

  return (
    <>
      <div className="flex items-center justify-between rounded-md border p-3">
        <span className="text-sm text-muted-foreground">{t("app.pos.checks.toPay")}</span>
        <span className="text-xl font-semibold tabular-nums">{fmt(check.total)}</span>
      </div>
      {check.unsentCount > 0 && <p className="text-xs text-muted-foreground">{t("app.pos.checks.unsentOnPay")}</p>}
      <div className="grid grid-cols-2 gap-2">
        {methodButton("cash", <Banknote className="h-4 w-4" />, t("app.sales.paymentMethods.cash"))}
        {methodButton("card", <CreditCard className="h-4 w-4" />, t("app.sales.paymentMethods.card"))}
        {methodButton("other", <Wallet className="h-4 w-4" />, t("app.sales.paymentMethods.other"))}
        {methodButton("split", <SplitSquareHorizontal className="h-4 w-4" />, t("app.pos.recorder.split"))}
      </div>
      {method === "cash" && (
        <div className="flex items-center gap-2">
          <Input type="number" inputMode="decimal" min={0} step="0.01" placeholder={t("app.pos.recorder.tendered")} aria-label={t("app.pos.recorder.tendered")} value={tendered} onChange={(e) => setTendered(e.target.value)} />
          {change != null && <span className={cn("whitespace-nowrap text-sm", change < 0 ? "text-destructive" : "text-muted-foreground")}>{t("app.pos.recorder.change")}: {fmt(Math.max(0, change))}</span>}
        </div>
      )}
      {method === "split" && <SplitTenderPanel split={split} formatCurrency={fmt} />}
      <Button variant="outline" className="gap-1.5" disabled={busy} onClick={() => setBillOpen(true)}>
        <Users className="h-4 w-4" />
        {t("app.pos.billSplit.open")}
      </Button>
      <Button className="h-11" disabled={busy || (method === "split" && !split.ready)} onClick={() => void pay()}>
        {busy ? t("app.pos.recorder.processing") : t("app.pos.checks.payNow", { total: fmt(check.total) })}
      </Button>

      <SplitBillSheet
        open={billOpen}
        onOpenChange={setBillOpen}
        lines={active.map((l) => ({
          key: l.id,
          ...(l.comboId ? { comboId: l.comboId } : { menuItemId: l.menuItemId! }),
          name: l.name,
          size: (l.comboId ? "regular" : l.size) as "regular",
          quantity: l.quantity,
          unitPrice: l.unitPrice,
        }))}
        total={check.total}
        vatRate={props.vatRate}
        pricesInclusive={props.pricesInclusive}
        order={{ restaurantId, branchId: check.branchId, shiftId: props.shiftId, tableId: check.tableId }}
        offline={{ cashierId: "" }}
        chargeCard={props.chargeCard}
        onTenders={(amounts) => {
          split.fill(amounts);
          setMethod("split");
        }}
        submit={async (input, opts) => {
          const res = await payCheck(check.id, { restaurantId, expectedVersion: check.version, shiftId: props.shiftId, parts: input.parts }, opts);
          return { billGroupId: res.billGroupId ?? "", sales: res.sales.map((s, i) => ({ ...s, billPart: s.billPart ?? { groupId: res.billGroupId ?? "", index: i + 1, count: res.sales.length } })) };
        }}
        onRecorded={(parts) =>
          props.onDone(
            parts.map((p) => ({
              receiptNumber: p.receiptNumber,
              transaction: p.transaction!,
              salesItems: p.salesItems,
              lines: p.lines.map((bl) => ({ ...active.find((l) => l.id === bl.key)!, quantity: bl.quantity, lineTotal: roundMoney(bl.unitPrice * bl.quantity) })),
              payments: p.payments,
              documentDiscount: p.totals.documentDiscount,
              documentSurcharge: p.totals.documentSurcharge,
            })),
            check,
          )
        }
        formatCurrency={fmt}
        restaurantName={props.restaurantName}
      />
    </>
  );
}

export { checkSaleLine };
