import { useState, useMemo, useEffect, useCallback } from "react";
import { format, parseISO, startOfDay, endOfDay } from "date-fns";
import {
  CalendarIcon,
  Upload,
  Plus,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Download,
  Trash2,
  Info,
} from "lucide-react";
import { toast } from "sonner";

import { db } from "@/integrations/db/client";
import { splitInclusive } from "@/lib/vatInclusive";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useCurrency } from "@/hooks/useCurrency";
import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";

type BackfillRow = {
  id: string;
  restaurant_id: string;
  branch_id: string;
  business_date: string;
  cash_amount: number;
  card_amount: number;
  total_amount: number;
  source: "manual" | "csv";
  status: "queued" | "reconciled" | "discarded";
  notes: string | null;
  created_at: string;
  reconciled_at: string | null;
  adjustment_cash: number | null;
  adjustment_card: number | null;
  adjustment_receipt_prefix: string | null;
};

type EodSale = {
  payment_method: string;
  total: number;
  receipt_number: string | null;
};

export default function PosBackfill() {
  const { restaurant, user, profile } = useAuth();
  const { branches, activeBranchId } = useBranch();
  const { format: formatCurrency } = useCurrency();

  const activeBranches = useMemo(
    () => branches.filter((b) => b.is_active),
    [branches],
  );

  const defaultBranchId =
    activeBranchId ||
    activeBranches.find((b) => b.is_primary)?.id ||
    activeBranches[0]?.id ||
    "";

  // ---- Queue form ----
  const [branchId, setBranchId] = useState<string>(defaultBranchId);
  const [date, setDate] = useState<Date>(new Date());
  const [cashTotal, setCashTotal] = useState<string>("");
  const [cardTotal, setCardTotal] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  // ---- CSV ----
  const [csvBusy, setCsvBusy] = useState(false);

  // ---- Reconcile state ----
  const [filterBranchId, setFilterBranchId] = useState<string>(defaultBranchId);
  const [entries, setEntries] = useState<BackfillRow[]>([]);
  const [eodByDate, setEodByDate] = useState<
    Record<string, { cash: number; card: number; receipts: string[] }>
  >({});
  const [loading, setLoading] = useState(false);
  const [reconcilingId, setReconcilingId] = useState<string | null>(null);

  const cashAmount = parseFloat(cashTotal) || 0;
  const cardAmount = parseFloat(cardTotal) || 0;
  const grandTotal = cashAmount + cardAmount;
  const hasAmounts = cashAmount > 0 || cardAmount > 0;

  const filterBranch = activeBranches.find((b) => b.id === filterBranchId);

  // ---- Loaders -----------------------------------------------------
  const loadEntries = useCallback(async () => {
    if (!restaurant?.id || !filterBranchId) {
      setEntries([]);
      setEodByDate({});
      return;
    }
    setLoading(true);
    try {
      const { data: rows, error } = await db
        .from("pos_backfill_entries")
        .select("*")
        .eq("restaurant_id", restaurant.id)
        .eq("branch_id", filterBranchId)
        .order("business_date", { ascending: false })
        .limit(500);
      if (error) throw error;
      const list = (rows ?? []) as BackfillRow[];
      setEntries(list);

      // Pull manual EOD sales for the dates we have entries on
      if (list.length === 0) {
        setEodByDate({});
        return;
      }
      const dates = Array.from(new Set(list.map((r) => r.business_date)));
      const minDate = dates.reduce((a, b) => (a < b ? a : b));
      const maxDate = dates.reduce((a, b) => (a > b ? a : b));
      const fromIso = startOfDay(parseISO(minDate)).toISOString();
      const toIso = endOfDay(parseISO(maxDate)).toISOString();

      const { data: salesRows, error: salesErr } = await db
        .from("sales_transactions")
        .select("payment_method, total, receipt_number, created_at, branch_id")
        .eq("restaurant_id", restaurant.id)
        .eq("branch_id", filterBranchId)
        .gte("created_at", fromIso)
        .lte("created_at", toIso)
        .like("receipt_number", "EOD-%");
      if (salesErr) throw salesErr;

      const byDate: Record<
        string,
        { cash: number; card: number; receipts: string[] }
      > = {};
      for (const s of (salesRows ?? []) as Array<
        EodSale & { created_at: string }
      >) {
        const dKey = format(new Date(s.created_at), "yyyy-MM-dd");
        if (!byDate[dKey]) byDate[dKey] = { cash: 0, card: 0, receipts: [] };
        const amt = Number(s.total) || 0;
        if (s.payment_method === "cash") byDate[dKey].cash += amt;
        else if (s.payment_method === "card") byDate[dKey].card += amt;
        if (s.receipt_number) byDate[dKey].receipts.push(s.receipt_number);
      }
      setEodByDate(byDate);
    } catch (err) {
      console.error("[PosBackfill] load failed", err);
      toast.error("Could not load backfill entries", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  }, [restaurant?.id, filterBranchId]);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  // ---- Queue an entry ---------------------------------------------
  const queueEntry = async (
    payload: {
      branch_id: string;
      business_date: string;
      cash_amount: number;
      card_amount: number;
      notes: string | null;
      source: "manual" | "csv";
    },
  ) => {
    if (!restaurant?.id) throw new Error("Restaurant context missing");
    const { error } = await db
      .from("pos_backfill_entries")
      .insert({
        restaurant_id: restaurant.id,
        branch_id: payload.branch_id,
        business_date: payload.business_date,
        cash_amount: payload.cash_amount,
        card_amount: payload.card_amount,
        notes: payload.notes,
        source: payload.source,
        created_by: user?.id ?? null,
      } as never);
    if (error) throw error;
  };

  const handleManualSubmit = async () => {
    if (!branchId) return toast.error("Select a branch");
    if (!hasAmounts) return toast.error("Enter cash or card total");
    if (date > new Date()) return toast.error("Date cannot be in the future");
    setSubmitting(true);
    try {
      await queueEntry({
        branch_id: branchId,
        business_date: format(date, "yyyy-MM-dd"),
        cash_amount: cashAmount,
        card_amount: cardAmount,
        notes: notes.trim() || null,
        source: "manual",
      });
      toast.success(
        `Queued ${formatCurrency(grandTotal)} for ${format(date, "PPP")}`,
      );
      setCashTotal("");
      setCardTotal("");
      setNotes("");
      if (branchId === filterBranchId) loadEntries();
    } catch (err) {
      toast.error("Queue failed", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setSubmitting(false);
    }
  };

  // ---- CSV --------------------------------------------------------
  const downloadTemplate = () => {
    const csv = "business_date,cash_amount,card_amount,notes\n2026-05-01,1200.00,800.00,Pre-POS daily Z-report\n";
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "pos-backfill-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCsv = async (file: File) => {
    if (!branchId) return toast.error("Select a branch first");
    setCsvBusy(true);
    try {
      const text = await file.text();
      const lines = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      if (lines.length < 2) throw new Error("CSV is empty");
      const header = lines[0].toLowerCase().split(",").map((s) => s.trim());
      const idxDate = header.indexOf("business_date");
      const idxCash = header.indexOf("cash_amount");
      const idxCard = header.indexOf("card_amount");
      const idxNotes = header.indexOf("notes");
      if (idxDate < 0 || idxCash < 0 || idxCard < 0) {
        throw new Error(
          "CSV must include business_date, cash_amount, card_amount columns",
        );
      }
      let ok = 0;
      let failed = 0;
      const errors: string[] = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(",");
        const dRaw = (cols[idxDate] || "").trim();
        const cash = parseFloat((cols[idxCash] || "0").trim()) || 0;
        const card = parseFloat((cols[idxCard] || "0").trim()) || 0;
        const note = idxNotes >= 0 ? (cols[idxNotes] || "").trim() : "";
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dRaw)) {
          failed++;
          errors.push(`Row ${i + 1}: bad date "${dRaw}"`);
          continue;
        }
        if (cash <= 0 && card <= 0) {
          failed++;
          errors.push(`Row ${i + 1}: cash and card both zero`);
          continue;
        }
        try {
          await queueEntry({
            branch_id: branchId,
            business_date: dRaw,
            cash_amount: cash,
            card_amount: card,
            notes: note || null,
            source: "csv",
          });
          ok++;
        } catch (e) {
          failed++;
          errors.push(
            `Row ${i + 1}: ${e instanceof Error ? e.message : "insert failed"}`,
          );
        }
      }
      if (ok > 0) toast.success(`Queued ${ok} row${ok === 1 ? "" : "s"}`);
      if (failed > 0) {
        toast.warning(`${failed} row${failed === 1 ? "" : "s"} skipped`, {
          description: errors.slice(0, 5).join(" · "),
        });
      }
      if (branchId === filterBranchId) loadEntries();
    } catch (err) {
      toast.error("CSV import failed", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setCsvBusy(false);
    }
  };

  // ---- Reconcile --------------------------------------------------
  const reconcileEntry = async (row: BackfillRow) => {
    if (!restaurant?.id) return;
    const eod = eodByDate[row.business_date] || { cash: 0, card: 0, receipts: [] };
    const adjCash = +(Number(row.cash_amount) - eod.cash).toFixed(2);
    const adjCard = +(Number(row.card_amount) - eod.card).toFixed(2);
    setReconcilingId(row.id);
    try {
      const dateStamp = row.business_date.replace(/-/g, "");
      const prefix = `BACKFILL-ADJ-${dateStamp}`;
      const ts = new Date(`${row.business_date}T12:00:00`);
      const isoTs = ts.toISOString();
      const rows: Array<Record<string, unknown>> = [];
      const rand = () =>
        Math.floor(Math.random() * 10000).toString().padStart(4, "0");
      if (Math.abs(adjCash) >= 0.01) {
        const cashSplit = splitInclusive(adjCash);
        rows.push({
          restaurant_id: restaurant.id,
          branch_id: row.branch_id,
          payment_method: "cash",
          subtotal: cashSplit.net,
          tax: cashSplit.vat,
          total: adjCash,
          receipt_number: `${prefix}-CASH-${rand()}`,
          settlement_status: "paid",
          created_at: isoTs,
          shift_id: null,
        });
      }
      if (Math.abs(adjCard) >= 0.01) {
        const cardSplit = splitInclusive(adjCard);
        rows.push({
          restaurant_id: restaurant.id,
          branch_id: row.branch_id,
          payment_method: "card",
          subtotal: cardSplit.net,
          tax: cardSplit.vat,
          total: adjCard,
          receipt_number: `${prefix}-CARD-${rand()}`,
          settlement_status: "paid",
          created_at: isoTs,
          shift_id: null,
        });
      }
      if (rows.length > 0) {
        const { error: insErr } = await db
          .from("sales_transactions")
          .insert(rows as never);
        if (insErr) throw insErr;
      }
      const { error: upErr } = await db
        .from("pos_backfill_entries")
        .update({
          status: "reconciled",
          reconciled_at: new Date().toISOString(),
          reconciled_by: user?.id ?? null,
          adjustment_cash: adjCash,
          adjustment_card: adjCard,
          adjustment_receipt_prefix: rows.length > 0 ? prefix : null,
          notes: [
            row.notes ?? "",
            `Reconciled by ${profile?.full_name || user?.email || "user"} on ${format(new Date(), "PPP")}`,
          ]
            .filter(Boolean)
            .join(" · "),
        } as never)
        .eq("id", row.id);
      if (upErr) throw upErr;

      toast.success(
        rows.length > 0
          ? `Posted adjustment ${formatCurrency(adjCash + adjCard)}`
          : "Marked reconciled (no variance)",
      );
      loadEntries();
    } catch (err) {
      toast.error("Reconcile failed", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setReconcilingId(null);
    }
  };

  const discardEntry = async (row: BackfillRow) => {
    const { error } = await db
      .from("pos_backfill_entries")
      .update({ status: "discarded" } as never)
      .eq("id", row.id);
    if (error) return toast.error(error.message);
    toast.success("Entry discarded");
    loadEntries();
  };

  // ---- Render -----------------------------------------------------
  const queued = entries.filter((e) => e.status === "queued");
  const reconciled = entries.filter((e) => e.status === "reconciled");

  return (
    <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
      <div>
        <h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight">POS Backfill</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Queue daily POS totals for a branch that went live after the fact, then
          reconcile them against earlier manual End-of-Day entries. Adjustments
          post as separate sales rows so the original EOD entries stay intact.
        </p>
      </div>

      <Tabs defaultValue="queue" className="space-y-4">
        <TabsList>
          <TabsTrigger value="queue">Queue entries</TabsTrigger>
          <TabsTrigger value="reconcile">
            Reconcile
            {queued.length > 0 && (
              <Badge variant="secondary" className="ml-2">
                {queued.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ============ QUEUE TAB ============ */}
        <TabsContent value="queue" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium">Manual entry</CardTitle>
              <CardDescription>
                Add one day at a time. Use this for corrections or small ranges.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Branch</Label>
                  <Select value={branchId} onValueChange={setBranchId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select branch" />
                    </SelectTrigger>
                    <SelectContent>
                      {activeBranches.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.name}
                          {b.code ? ` (${b.code})` : ""}
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
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Cash total</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={cashTotal}
                    onChange={(e) => setCashTotal(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Card total</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={cardTotal}
                    onChange={(e) => setCardTotal(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Notes (optional)</Label>
                <Textarea
                  rows={2}
                  placeholder="e.g. Imported from POS once installation completed"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
              <div className="flex items-center justify-between rounded-lg border bg-muted/30 p-3">
                <div className="text-sm">
                  <div className="text-muted-foreground">Total to queue</div>
                  <div className="text-lg font-semibold tabular-nums">
                    {formatCurrency(grandTotal)}
                  </div>
                </div>
                <Button
                  onClick={handleManualSubmit}
                  disabled={submitting || !hasAmounts || !branchId}
                >
                  {submitting ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Plus className="h-4 w-4 mr-2" />
                  )}
                  Queue entry
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium">CSV upload</CardTitle>
              <CardDescription>
                Bulk-queue daily totals. Goes into the selected branch above.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={downloadTemplate}>
                  <Download className="h-4 w-4 mr-2" />
                  Download template
                </Button>
                <label>
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleCsv(f);
                      e.target.value = "";
                    }}
                  />
                  <Button asChild disabled={csvBusy || !branchId}>
                    <span>
                      {csvBusy ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <Upload className="h-4 w-4 mr-2" />
                      )}
                      Upload CSV
                    </span>
                  </Button>
                </label>
              </div>
              <p className="text-xs text-muted-foreground">
                Columns: <code>business_date</code> (YYYY-MM-DD),{" "}
                <code>cash_amount</code>, <code>card_amount</code>,{" "}
                <code>notes</code> (optional).
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ============ RECONCILE TAB ============ */}
        <TabsContent value="reconcile" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <CardTitle className="text-base font-medium">Reconciliation</CardTitle>
                  <CardDescription>
                    Compare queued POS totals against the manual EOD entries on
                    the same day, then post an adjustment to balance.
                  </CardDescription>
                </div>
                <div className="flex items-end gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Branch</Label>
                    <Select
                      value={filterBranchId}
                      onValueChange={setFilterBranchId}
                    >
                      <SelectTrigger className="w-[220px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {activeBranches.map((b) => (
                          <SelectItem key={b.id} value={b.id}>
                            {b.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={loadEntries}
                    disabled={loading}
                  >
                    <RefreshCw
                      className={cn("h-4 w-4", loading && "animate-spin")}
                    />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {queued.length === 0 && reconciled.length === 0 ? (
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertTitle>No backfill entries</AlertTitle>
                  <AlertDescription>
                    Queue some entries for {filterBranch?.name ?? "this branch"}{" "}
                    on the Queue tab to start reconciling.
                  </AlertDescription>
                </Alert>
              ) : (
                <ScrollArea className="max-h-[60vh]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead className="text-right">
                          POS (queued)
                        </TableHead>
                        <TableHead className="text-right">
                          EOD (posted)
                        </TableHead>
                        <TableHead className="text-right">Variance</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {[...queued, ...reconciled].map((row) => {
                        const eod = eodByDate[row.business_date] || {
                          cash: 0,
                          card: 0,
                          receipts: [],
                        };
                        const eodTotal = eod.cash + eod.card;
                        const variance = Number(row.total_amount) - eodTotal;
                        const cashVar = Number(row.cash_amount) - eod.cash;
                        const cardVar = Number(row.card_amount) - eod.card;
                        const hasEod = eodTotal > 0;
                        return (
                          <TableRow key={row.id}>
                            <TableCell className="whitespace-nowrap">
                              <div className="font-medium">
                                {format(parseISO(row.business_date), "PP")}
                              </div>
                              <div className="text-xs text-muted-foreground capitalize">
                                {row.source}
                              </div>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              <div>{formatCurrency(Number(row.total_amount))}</div>
                              <div className="text-xs text-muted-foreground">
                                C {formatCurrency(Number(row.cash_amount))} / K{" "}
                                {formatCurrency(Number(row.card_amount))}
                              </div>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {hasEod ? (
                                <>
                                  <div>{formatCurrency(eodTotal)}</div>
                                  <div className="text-xs text-muted-foreground">
                                    C {formatCurrency(eod.cash)} / K{" "}
                                    {formatCurrency(eod.card)}
                                  </div>
                                </>
                              ) : (
                                <span className="text-xs text-muted-foreground">
                                  No EOD entry
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              <div
                                className={cn(
                                  "font-medium",
                                  Math.abs(variance) < 0.01
                                    ? "text-muted-foreground"
                                    : variance > 0
                                      ? "text-emerald-600"
                                      : "text-destructive",
                                )}
                              >
                                {variance >= 0 ? "+" : ""}
                                {formatCurrency(variance)}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                C {cashVar >= 0 ? "+" : ""}
                                {formatCurrency(cashVar)} / K{" "}
                                {cardVar >= 0 ? "+" : ""}
                                {formatCurrency(cardVar)}
                              </div>
                            </TableCell>
                            <TableCell>
                              {row.status === "queued" && (
                                <Badge variant="secondary">
                                  <AlertTriangle className="h-3 w-3 mr-1" />
                                  Queued
                                </Badge>
                              )}
                              {row.status === "reconciled" && (
                                <Badge className="bg-emerald-600 hover:bg-emerald-600">
                                  <CheckCircle2 className="h-3 w-3 mr-1" />
                                  Reconciled
                                </Badge>
                              )}
                              {row.status === "discarded" && (
                                <Badge variant="outline">Discarded</Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              {row.status === "queued" ? (
                                <div className="flex justify-end gap-2">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => discardEntry(row)}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button
                                    size="sm"
                                    onClick={() => reconcileEntry(row)}
                                    disabled={reconcilingId === row.id}
                                  >
                                    {reconcilingId === row.id ? (
                                      <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                                    ) : (
                                      <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                                    )}
                                    Post adjustment
                                  </Button>
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground">
                                  {row.adjustment_receipt_prefix ?? "-"}
                                </span>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}