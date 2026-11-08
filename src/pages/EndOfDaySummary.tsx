import { useState, useMemo, useEffect } from "react";
import { format } from "date-fns";
import { CalendarIcon, Banknote, CreditCard, Loader2, FileText, Calculator, ExternalLink, AlertTriangle, CheckCircle2, Store, Info, Zap } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useCurrency } from "@/hooks/useCurrency";
import { useCOGSPosting } from "@/hooks/useCOGSPosting";
import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";

export default function EndOfDaySummary() {
  const { restaurant, user, profile } = useAuth();
  const { branches, activeBranchId } = useBranch();
  const { format: formatCurrency } = useCurrency();
  const { cogsAccounts } = useCOGSPosting();
  const navigate = useNavigate();

  const activeBranches = useMemo(
    () => branches.filter((b) => b.is_active),
    [branches],
  );

  const defaultBranchId =
    activeBranchId ||
    activeBranches.find((b) => b.is_primary)?.id ||
    activeBranches[0]?.id ||
    "";

  const [branchId, setBranchId] = useState<string>(defaultBranchId);
  const [date, setDate] = useState<Date>(new Date());
  const [cashTotal, setCashTotal] = useState<string>("");
  const [cardTotal, setCardTotal] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  // ---- No-POS mode (new branch, POS not deployed yet) ----------
  const [noPosMode, setNoPosMode] = useState(false);

  // ---- Estimated COGS (optional) ---------------------------------
  // For manual EOD sales there are no menu items attached, so the
  // normal recipe-based COGS pipeline can't fire. Owners can opt in
  // to post an estimated COGS amount as a percentage of net sales
  // using an existing COGS account (5000-5999 range).
  const [postEstimatedCogs, setPostEstimatedCogs] = useState(false);
  const [cogsPct, setCogsPct] = useState<string>("30");
  const [cogsAccountId, setCogsAccountId] = useState<string>("");

  const cashAmount = parseFloat(cashTotal) || 0;
  const cardAmount = parseFloat(cardTotal) || 0;
  const grandTotal = cashAmount + cardAmount;
  const hasAmounts = cashAmount > 0 || cardAmount > 0;
  const cogsPctNum = Math.max(0, Math.min(100, parseFloat(cogsPct) || 0));
  const estimatedCogsAmount = +(grandTotal * (cogsPctNum / 100)).toFixed(2);

  const selectedBranch = activeBranches.find((b) => b.id === branchId);

  // ---- Open shift drawer comparison -------------------------------
  // If a shift is currently open for the selected branch, surface its
  // expected cash/card so the owner can spot mis-tagged totals before
  // posting. expected_cash / expected_card are maintained by the
  // shift control flow and reflect drawer + POS sales for that shift.
  type OpenShift = {
    id: string;
    opened_at: string;
    expected_cash: number | null;
    expected_card: number | null;
    counted_cash: number | null;
    counted_card: number | null;
    opening_float: number | null;
  };
  const [openShift, setOpenShift] = useState<OpenShift | null>(null);
  const [acknowledgedMismatch, setAcknowledgedMismatch] = useState(false);
  const [shiftQueryDone, setShiftQueryDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setOpenShift(null);
    setAcknowledgedMismatch(false);
    setShiftQueryDone(false);
    if (!restaurant?.id || !branchId || noPosMode) return;
    (async () => {
      const { data, error } = await db
        .from("shifts")
        .select(
          "id, opened_at, expected_cash, expected_card, counted_cash, counted_card, opening_float",
        )
        .eq("restaurant_id", restaurant.id)
        .eq("branch_id", branchId)
        .eq("status", "open")
        .order("opened_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        setShiftQueryDone(true);
        return;
      }
      setOpenShift((data as OpenShift) ?? null);
      setShiftQueryDone(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [restaurant?.id, branchId, noPosMode]);

  // Reset acknowledgement when the entered totals change.
  useEffect(() => {
    setAcknowledgedMismatch(false);
  }, [cashTotal, cardTotal]);

  // Mismatch is "significant" if either leg differs by > max(1% , ﷼5)
  const expectedCash = Number(openShift?.expected_cash ?? 0);
  const expectedCard = Number(openShift?.expected_card ?? 0);
  const expectedTotal = expectedCash + expectedCard;
  const cashDiff = cashAmount - expectedCash;
  const cardDiff = cardAmount - expectedCard;
  const tolerance = (base: number) => Math.max(5, Math.abs(base) * 0.01);
  const cashOff = !!openShift && Math.abs(cashDiff) > tolerance(expectedCash);
  const cardOff = !!openShift && Math.abs(cardDiff) > tolerance(expectedCard);
  const hasMismatch = hasAmounts && !noPosMode && (cashOff || cardOff);
  const blockSubmit = hasMismatch && !acknowledgedMismatch;

  const DEFAULT_NOPOS_NOTE = "Manual entry - POS not deployed yet";

  const handleSubmit = async (opts?: {
    dateOverride?: Date;
    noPosOverride?: boolean;
    notesOverride?: string;
  }) => {
    const effectiveDate = opts?.dateOverride ?? date;
    const effectiveNoPos = opts?.noPosOverride ?? noPosMode;
    const effectiveNotes = opts?.notesOverride ?? notes;
    if (!restaurant?.id) {
      toast.error("Restaurant context missing");
      return;
    }
    if (!branchId) {
      toast.error("Please select a branch");
      return;
    }
    if (!hasAmounts) {
      toast.error("Enter at least one of cash or card total");
      return;
    }
    if (effectiveNoPos && !effectiveNotes.trim()) {
      toast.error("Audit note is required for No-POS entries");
      return;
    }
    if (effectiveDate > new Date()) {
      toast.error("Date cannot be in the future");
      return;
    }

    setSubmitting(true);
    // Use noon local time of selected day to avoid timezone day-boundary issues
    const ts = new Date(effectiveDate);
    ts.setHours(12, 0, 0, 0);
    const isoTs = ts.toISOString();
    const dateStamp = format(effectiveDate, "yyyyMMdd");
    const isoDate = format(effectiveDate, "yyyy-MM-dd");
    const rand = () =>
      Math.floor(Math.random() * 10000).toString().padStart(4, "0");
    const receiptPrefix = effectiveNoPos ? `EOD-NOPOS-${dateStamp}` : `EOD-${dateStamp}`;
    const noPosNote = effectiveNoPos ? "No POS" : "";
    const fullNotes = [noPosNote, effectiveNotes.trim()].filter(Boolean).join(" - ");
    const noteSuffix = fullNotes
      ? ` - ${fullNotes}`
      : "";

    // Pre-validate COGS section before any insert.
    if (postEstimatedCogs) {
      if (!cogsAccountId) {
        toast.error("Select a COGS account to post the estimate");
        setSubmitting(false);
        return;
      }
      if (estimatedCogsAmount <= 0) {
        toast.error("Estimated COGS must be greater than zero");
        setSubmitting(false);
        return;
      }
    }

    const rows: Array<Record<string, unknown>> = [];
    if (cashAmount > 0) {
      rows.push({
        restaurant_id: restaurant.id,
        branch_id: branchId,
        payment_method: "cash",
        subtotal: cashAmount,
        tax: 0,
        total: cashAmount,
        receipt_number: `${receiptPrefix}-CASH-${rand()}`,
        settlement_status: "paid",
        created_at: isoTs,
        shift_id: null,
      });
    }
    if (cardAmount > 0) {
      rows.push({
        restaurant_id: restaurant.id,
        branch_id: branchId,
        payment_method: "card",
        subtotal: cardAmount,
        tax: 0,
        total: cardAmount,
        receipt_number: `${receiptPrefix}-CARD-${rand()}`,
        settlement_status: "paid",
        created_at: isoTs,
        shift_id: null,
      });
    }

    try {
      const { error } = await db
        .from("sales_transactions")
        .insert(rows as never);
      if (error) throw error;

      // ---- Optional estimated COGS posting ----
      let cogsToastDetail = "";
      if (postEstimatedCogs && user) {
        try {
          // 1) Create an "approved" daily COGS submission for this date/branch
          //    Use a unique shift_type label so it won't collide with the
          //    daily morning/night submissions on the same date.
          const submissionShiftType = `eod_estimate_${Date.now()}`;
          const { data: sub, error: subErr } = await db
            .from("daily_cogs_submissions")
            .insert({
              restaurant_id: restaurant.id,
              submission_date: isoDate,
              shift_type: submissionShiftType,
              cashier_user_id: user.id,
              cashier_name: profile?.full_name || user.email || "EOD Summary",
              cash_sales: cashAmount,
              card_sales: cardAmount,
              total_sales: grandTotal,
              purchases_value: estimatedCogsAmount,
              cogs: estimatedCogsAmount,
              food_cost_percentage: cogsPctNum,
              status: "approved",
              submitted_at: new Date().toISOString(),
              approved_at: new Date().toISOString(),
              approved_by: user.id,
            } as never)
            .select("id")
            .single();
          if (subErr) throw subErr;

          // 2) Create a single COGS purchase row to carry the estimated amount
          const { data: pur, error: purErr } = await db
            .from("cogs_purchases")
            .insert({
              submission_id: sub!.id,
              supplier_name: "EOD Estimate",
              invoice_number: `EOD-${dateStamp}`,
              payment_mode: "cash",
              item_type: "other",
              amount: estimatedCogsAmount,
              missing_bill: true,
              notes: `Estimated COGS for manual EOD summary (${cogsPctNum}% of ${formatCurrency(grandTotal)})${notes.trim() ? ` - ${notes.trim()}` : ""}`,
              entered_by: user.id,
              cogs_account_id: cogsAccountId,
            } as never)
            .select("id")
            .single();
          if (purErr) throw purErr;

          // 3) Post it to the ledger
          const { error: postErr } = await db.rpc(
            "post_purchase_to_cogs" as never,
            {
              p_purchase_id: pur!.id,
              p_cogs_account_id: cogsAccountId,
            } as never,
          );
          if (postErr) throw postErr;

          cogsToastDetail = ` · COGS posted ${formatCurrency(estimatedCogsAmount)} (${cogsPctNum}%)`;
        } catch (cogsErr) {
          const msg = cogsErr instanceof Error ? cogsErr.message : "Failed to post estimated COGS";
          console.error("[EndOfDaySummary] estimated COGS failed", cogsErr);
          toast.warning("Sales recorded - COGS estimate failed", { description: msg });
        }
      }

      toast.success(
        `Posted to ${selectedBranch?.name ?? "branch"}${selectedBranch?.code ? ` (${selectedBranch.code})` : ""} · ${format(date, "PPP")}`,
        {
          duration: 8000,
          description: `Cash ${formatCurrency(cashAmount)} + Card ${formatCurrency(cardAmount)} = ${formatCurrency(grandTotal)}${noteSuffix}${cogsToastDetail}`,
          action: {
            label: "View in Sales",
            onClick: () => navigate("/sales"),
          },
        },
      );
      setCashTotal("");
      setCardTotal("");
      setNotes("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to record summary";
      console.error("[EndOfDaySummary] insert failed", err);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
      <div>
        <h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight">End-of-Day Summary</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Record a day's totals when the POS wasn't used. Creates one cash and
          one card sale transaction tagged to the selected branch.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">Day totals</CardTitle>
          <CardDescription>
            All amounts post to the selected branch on the selected business
            date. Inventory & COGS are not affected - reconcile via stocktake.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Branch + Date */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="branch">Branch</Label>
              <Select value={branchId} onValueChange={setBranchId}>
                <SelectTrigger id="branch">
                  <SelectValue placeholder="Select branch" />
                </SelectTrigger>
                <SelectContent>
                  {activeBranches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                      {b.is_primary ? " (Primary)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Business date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !date && "text-muted-foreground",
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {date ? format(date, "PPP") : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={date}
                    onSelect={(d) => d && setDate(d)}
                    disabled={(d) => d > new Date()}
                    initialFocus
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {/* No-POS preset toggle */}
          <div className="flex items-start justify-between gap-3 rounded-lg border bg-muted/30 p-3">
            <div className="space-y-0.5">
              <Label className="flex items-center gap-2 text-sm font-medium">
                <Store className="h-4 w-4" /> New branch / No POS yet
              </Label>
              <p className="text-xs text-muted-foreground">
                Skip shift-drawer validation and auto-label this entry as
                having no live POS. Use when a branch is not yet deployed.
              </p>
            </div>
            <Switch
              id="no-pos-toggle"
              checked={noPosMode}
              onCheckedChange={setNoPosMode}
            />
          </div>

          <Separator />

          {/* Cash + Card */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="cash" className="flex items-center gap-2">
                <Banknote className="h-4 w-4 text-emerald-600" /> Total cash
              </Label>
              <Input
                id="cash"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={cashTotal}
                onChange={(e) => setCashTotal(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="card" className="flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-blue-600" /> Total card
              </Label>
              <Input
                id="card"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={cardTotal}
                onChange={(e) => setCardTotal(e.target.value)}
              />
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes" className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              {noPosMode ? (
                <>
                  Audit note <span className="text-destructive">*</span>
                </>
              ) : (
                <>Notes (optional)</>
              )}
            </Label>
            <Textarea
              id="notes"
              placeholder={
                noPosMode
                  ? "e.g. Manual entry - POS not deployed yet. Record who provided the totals and how they were counted."
                  : "e.g. POS offline - totals taken from cash drawer count and POS card terminal Z-report."
              }
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className={cn(noPosMode && !notes.trim() && "border-destructive focus-visible:ring-destructive")}
            />
            {noPosMode && (
              <p className="text-xs text-muted-foreground">
                Required for audit trail. Explain why this branch has no POS and
                who verified the totals.
              </p>
            )}
          </div>

          {/* Summary */}
          {hasAmounts && (
            <Alert>
              <AlertTitle>Will create {(cashAmount > 0 ? 1 : 0) + (cardAmount > 0 ? 1 : 0)} transaction(s)</AlertTitle>
              <AlertDescription className="mt-2 space-y-1 text-sm">
                {cashAmount > 0 && (
                  <div className="flex justify-between">
                    <span>Cash sale</span>
                    <span className="font-medium">{formatCurrency(cashAmount)}</span>
                  </div>
                )}
                {cardAmount > 0 && (
                  <div className="flex justify-between">
                    <span>Card sale</span>
                    <span className="font-medium">{formatCurrency(cardAmount)}</span>
                  </div>
                )}
                <div className="flex justify-between border-t pt-1 mt-1">
                  <span className="font-medium">Total</span>
                  <span className="font-semibold">{formatCurrency(grandTotal)}</span>
                </div>
                <div className="text-muted-foreground pt-1">
                  Branch: {selectedBranch?.name ?? "-"} · Date: {format(date, "PPP")}
                </div>
              </AlertDescription>
            </Alert>
          )}

          {/* Open shift drawer comparison */}
          {openShift && hasAmounts && (
            hasMismatch ? (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>
                  Totals don't match the open shift drawer
                </AlertTitle>
                <AlertDescription className="mt-2 space-y-2 text-sm">
                  <div className="text-xs">
                    Open shift at {selectedBranch?.name ?? "this branch"} since{" "}
                    {format(new Date(openShift.opened_at), "PPp")}.
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs rounded-md bg-background/50 p-2">
                    <div className="font-medium">&nbsp;</div>
                    <div className="font-medium text-right">Entered</div>
                    <div className="font-medium text-right">Shift expected</div>
                    <div>Cash</div>
                    <div className="text-right">{formatCurrency(cashAmount)}</div>
                    <div className={cn("text-right", cashOff && "font-semibold")}>
                      {formatCurrency(expectedCash)}
                      {cashOff && (
                        <span className="block text-[10px] opacity-80">
                          Δ {cashDiff > 0 ? "+" : ""}
                          {formatCurrency(cashDiff)}
                        </span>
                      )}
                    </div>
                    <div>Card</div>
                    <div className="text-right">{formatCurrency(cardAmount)}</div>
                    <div className={cn("text-right", cardOff && "font-semibold")}>
                      {formatCurrency(expectedCard)}
                      {cardOff && (
                        <span className="block text-[10px] opacity-80">
                          Δ {cardDiff > 0 ? "+" : ""}
                          {formatCurrency(cardDiff)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-xs">
                    Possible causes: wrong branch selected, shift still has
                    pending sales, or you're double-posting POS totals.
                  </div>
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <label className="flex items-center gap-2 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={acknowledgedMismatch}
                        onChange={(e) => setAcknowledgedMismatch(e.target.checked)}
                        className="h-3.5 w-3.5"
                      />
                      I've checked the branch and want to post anyway
                    </label>
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-xs"
                      onClick={() => navigate("/shifts")}
                    >
                      Open Shifts <ExternalLink className="ml-1 h-3 w-3" />
                    </Button>
                  </div>
                </AlertDescription>
              </Alert>
            ) : (
              <Alert>
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                <AlertTitle>Matches the open shift drawer</AlertTitle>
                <AlertDescription className="text-xs">
                  Entered totals are within tolerance of the open shift's
                  expected cash ({formatCurrency(expectedCash)}) and card (
                  {formatCurrency(expectedCard)}).
                </AlertDescription>
              </Alert>
            )
          )}
          {!openShift && hasAmounts && shiftQueryDone && !noPosMode && (
            <Alert>
              <Info className="h-4 w-4 text-blue-600" />
              <AlertTitle>No open shift found</AlertTitle>
              <AlertDescription className="text-xs">
                There is no active shift drawer for{" "}
                {selectedBranch?.name ?? "this branch"}. POS/shift data is not
                available yet - you can still post this summary manually, or
                enable <strong>New branch / No POS yet</strong> mode if the
                branch isn't deployed.
              </AlertDescription>
            </Alert>
          )}

          <Separator />

          {/* Estimate COGS */}
          <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-0.5">
                <Label
                  htmlFor="cogs-toggle"
                  className="flex items-center gap-2 text-base font-medium"
                >
                  <Calculator className="h-4 w-4" /> Estimate &amp; post COGS
                </Label>
                <p className="text-xs text-muted-foreground">
                  No menu items are attached to manual EOD sales, so recipes
                  can't auto-deduct. Optionally post an estimated COGS amount
                  using a percentage of net sales and a COGS account.
                </p>
              </div>
              <Switch
                id="cogs-toggle"
                checked={postEstimatedCogs}
                onCheckedChange={setPostEstimatedCogs}
              />
            </div>

            {postEstimatedCogs && (
              <div className="space-y-3 pt-2">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="cogs-pct">Estimated COGS %</Label>
                    <Input
                      id="cogs-pct"
                      type="number"
                      inputMode="decimal"
                      min="0"
                      max="100"
                      step="0.1"
                      value={cogsPct}
                      onChange={(e) => setCogsPct(e.target.value)}
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Industry average for restaurants: 28-32%
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="cogs-account">COGS account</Label>
                    <Select value={cogsAccountId} onValueChange={setCogsAccountId}>
                      <SelectTrigger id="cogs-account">
                        <SelectValue placeholder="Select COGS account" />
                      </SelectTrigger>
                      <SelectContent>
                        {cogsAccounts.length === 0 ? (
                          <div className="px-2 py-1.5 text-xs text-muted-foreground">
                            No COGS accounts found in Chart of Accounts.
                          </div>
                        ) : (
                          cogsAccounts.map((a) => (
                            <SelectItem key={a.id} value={a.id}>
                              {a.account_code} - {a.account_name}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <Alert>
                  <AlertTitle className="flex items-center justify-between">
                    <span>Will post estimated COGS</span>
                    <span className="font-semibold">
                      {formatCurrency(estimatedCogsAmount)}
                    </span>
                  </AlertTitle>
                  <AlertDescription className="text-xs">
                    {cogsPctNum}% of {formatCurrency(grandTotal)} → debits the
                    selected COGS account and creates an approved daily COGS
                    submission tagged as "EOD Estimate". This is provisional -
                    a stocktake will true it up.
                  </AlertDescription>
                </Alert>
              </div>
            )}

            <div className="flex items-center justify-between pt-1">
              <p className="text-xs text-muted-foreground">
                Prefer a real stocktake?
              </p>
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto p-0 text-xs"
                onClick={() => navigate("/inventory")}
              >
                Open Weekly COGS Wizard
                <ExternalLink className="ml-1 h-3 w-3" />
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => navigate(-1)} disabled={submitting}>
              Cancel
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                const today = new Date();
                setDate(today);
                setNoPosMode(true);
                const effectiveNotes = notes.trim() || DEFAULT_NOPOS_NOTE;
                if (!notes.trim()) setNotes(DEFAULT_NOPOS_NOTE);
                handleSubmit({
                  dateOverride: today,
                  noPosOverride: true,
                  notesOverride: effectiveNotes,
                });
              }}
              disabled={submitting || !hasAmounts || !branchId}
              title="Posts today's totals to the selected branch with No-POS labeling"
            >
              <Zap className="mr-2 h-4 w-4" /> Post today
            </Button>
            <Button
              onClick={() => handleSubmit()}
              disabled={submitting || !hasAmounts || !branchId || blockSubmit || (noPosMode && !notes.trim())}
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Recording…
                </>
              ) : (
                "Record summary"
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
