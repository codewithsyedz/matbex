import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetDescription } from "@/components/ui/sheet";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Download, FileText, Save, RotateCcw, ExternalLink, ShieldCheck, Info,
  CheckCircle2, Circle, AlertTriangle, ChevronDown, History, BookOpen,
  ArrowRight, ArrowLeft,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/integrations/db/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  computeVatReturn,
  EMPTY_ADJUSTMENTS,
  formatPeriodLabel,
  monthBounds,
  quarterBounds,
  type PeriodMode,
  type VatAdjustments,
  type BoxRow,
  buildVatReturnCsv,
  downloadCsv,
} from "@/lib/vatReturn";
import { exportVatReturnPdf } from "@/lib/vatReturnPdf";
import { VatRecoverableReconciliationPanel } from "@/components/accounting/VatRecoverableReconciliationPanel";
import { VatRemittancePanel } from "@/components/accounting/VatRemittancePanel";
import { cn } from "@/lib/utils";

const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

const fmt = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type FilingStatus = "draft" | "ready" | "submitted" | "paid";

const STATUS_META: Record<FilingStatus, { label: string; tone: string }> = {
  draft:     { label: "Draft",     tone: "bg-muted text-foreground" },
  ready:     { label: "Ready",     tone: "bg-blue-500/10 text-blue-700 dark:text-blue-400" },
  submitted: { label: "Submitted", tone: "bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  paid:      { label: "Paid",      tone: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
};

const STEPS = [
  { id: 1, label: "Data completeness" },
  { id: 2, label: "VAT calculation" },
  { id: 3, label: "Adjustments" },
  { id: 4, label: "Final review" },
] as const;

export default function VatReturn() {
  const { restaurant, user } = useAuth() as any;
  const queryClient = useQueryClient();
  const now = new Date();

  // ---- Period state ----
  const [mode, setMode] = useState<PeriodMode>("quarter");
  const [year, setYear] = useState(now.getFullYear());
  const [quarter, setQuarter] = useState<1 | 2 | 3 | 4>(
    (Math.floor(now.getMonth() / 3) + 1) as 1 | 2 | 3 | 4,
  );
  const [month, setMonth] = useState(now.getMonth());

  const { start, end } = useMemo(
    () => (mode === "quarter" ? quarterBounds(year, quarter) : monthBounds(year, month)),
    [mode, year, quarter, month],
  );
  const startISO = format(start, "yyyy-MM-dd");
  const endISO = format(end, "yyyy-MM-dd");
  const endExclusive = new Date(end);
  endExclusive.setDate(endExclusive.getDate() + 1);

  // ---- Stepper state ----
  const [step, setStep] = useState(1);

  // ---- Sales / purchases / expenses queries ----
  const salesQ = useQuery({
    queryKey: ["vat-sales", restaurant?.id, startISO, endISO],
    enabled: !!restaurant?.id,
    queryFn: async () => {
      const { data, error } = await db
        .from("sales_transactions")
        .select("subtotal, tax, total")
        .eq("restaurant_id", restaurant!.id)
        .gte("created_at", start.toISOString())
        .lt("created_at", endExclusive.toISOString());
      if (error) throw error;
      return data ?? [];
    },
  });

  const purchasesQ = useQuery({
    queryKey: ["vat-purchases", restaurant?.id, startISO, endISO],
    enabled: !!restaurant?.id,
    queryFn: async () => {
      const { data, error } = await db
        .from("purchase_invoices")
        .select("subtotal, tax_amount, total_amount")
        .eq("restaurant_id", restaurant!.id)
        .gte("invoice_date", startISO)
        .lte("invoice_date", endISO);
      if (error) throw error;
      return data ?? [];
    },
  });

  const expensesQ = useQuery({
    queryKey: ["vat-expenses", restaurant?.id, startISO, endISO],
    enabled: !!restaurant?.id,
    queryFn: async () => {
      const { data, error } = await db
        .from("expenses")
        .select("amount")
        .eq("restaurant_id", restaurant!.id)
        .is("deleted_at", null)
        .gte("expense_date", startISO)
        .lte("expense_date", endISO);
      if (error) throw error;
      return data ?? [];
    },
  });

  // ---- Previous period (for delta warning) ----
  const prevPeriod = useMemo(() => {
    const d = new Date(start);
    d.setMonth(d.getMonth() - (mode === "quarter" ? 3 : 1));
    return mode === "quarter"
      ? quarterBounds(d.getFullYear(), (Math.floor(d.getMonth() / 3) + 1) as 1 | 2 | 3 | 4)
      : monthBounds(d.getFullYear(), d.getMonth());
  }, [start, mode]);

  const prevSalesQ = useQuery({
    queryKey: ["vat-prev-sales", restaurant?.id, format(prevPeriod.start, "yyyy-MM-dd")],
    enabled: !!restaurant?.id,
    queryFn: async () => {
      const e = new Date(prevPeriod.end); e.setDate(e.getDate() + 1);
      const { data, error } = await db
        .from("sales_transactions")
        .select("subtotal, tax, total")
        .eq("restaurant_id", restaurant!.id)
        .gte("created_at", prevPeriod.start.toISOString())
        .lt("created_at", e.toISOString());
      if (error) throw error;
      return data ?? [];
    },
  });

  // ---- Saved filing record ----
  const savedQ = useQuery({
    queryKey: ["vat-return-saved", restaurant?.id, startISO, endISO],
    enabled: !!restaurant?.id,
    queryFn: async () => {
      const { data, error } = await db
        .from("vat_returns")
        .select("*")
        .eq("restaurant_id", restaurant!.id)
        .eq("period_start", startISO)
        .eq("period_end", endISO)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const auditQ = useQuery({
    queryKey: ["vat-adj-log", restaurant?.id, startISO, endISO],
    enabled: !!restaurant?.id,
    queryFn: async () => {
      const { data, error } = await db
        .from("vat_return_adjustments_log")
        .select("*")
        .eq("restaurant_id", restaurant!.id)
        .eq("period_start", startISO)
        .eq("period_end", endISO)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  // ---- Adjustments + form state ----
  const [adjustments, setAdjustments] = useState<VatAdjustments>(EMPTY_ADJUSTMENTS);
  const [notes, setNotes] = useState("");
  const [zatcaMode, setZatcaMode] = useState(false);
  const [arabicLabels, setArabicLabels] = useState(false);
  const [adjReason, setAdjReason] = useState("");
  const [status, setStatus] = useState<FilingStatus>("draft");
  const [sadadNumber, setSadadNumber] = useState("");
  const [submittedAt, setSubmittedAt] = useState<string>("");
  const lastSavedAdjRef = useRef<VatAdjustments>(EMPTY_ADJUSTMENTS);

  useEffect(() => {
    if (!savedQ.data) {
      setAdjustments(EMPTY_ADJUSTMENTS);
      lastSavedAdjRef.current = EMPTY_ADJUSTMENTS;
      setNotes("");
      setStatus("draft");
      setSadadNumber("");
      setSubmittedAt("");
      setZatcaMode(false);
      return;
    }
    const d = savedQ.data as any;
    const next: VatAdjustments = {
      box1_adjustment: Number(d.box1_adjustment) || 0,
      box1_1_amount: Number(d.box1_1_amount) || 0, box1_1_adjustment: Number(d.box1_1_adjustment) || 0,
      box2_amount: Number(d.box2_amount) || 0, box2_adjustment: Number(d.box2_adjustment) || 0,
      box3_amount: Number(d.box3_amount) || 0, box3_adjustment: Number(d.box3_adjustment) || 0,
      box4_amount: Number(d.box4_amount) || 0, box4_adjustment: Number(d.box4_adjustment) || 0,
      box5_amount: Number(d.box5_amount) || 0, box5_adjustment: Number(d.box5_adjustment) || 0,
      box7_adjustment: Number(d.box7_adjustment) || 0,
      box7_1_amount: Number(d.box7_1_amount) || 0, box7_1_adjustment: Number(d.box7_1_adjustment) || 0,
      box8_amount: Number(d.box8_amount) || 0, box8_adjustment: Number(d.box8_adjustment) || 0,
      box8_1_amount: Number(d.box8_1_amount) || 0, box8_1_adjustment: Number(d.box8_1_adjustment) || 0,
      box9_amount: Number(d.box9_amount) || 0, box9_adjustment: Number(d.box9_adjustment) || 0,
      box9_1_amount: Number(d.box9_1_amount) || 0, box9_1_adjustment: Number(d.box9_1_adjustment) || 0,
      box10_amount: Number(d.box10_amount) || 0, box10_adjustment: Number(d.box10_adjustment) || 0,
      box11_amount: Number(d.box11_amount) || 0, box11_adjustment: Number(d.box11_adjustment) || 0,
      box14_corrections: Number(d.box14_corrections) || 0,
      box15_credit_carried: Number(d.box15_credit_carried) || 0,
    };
    setAdjustments(next);
    lastSavedAdjRef.current = next;
    setNotes(d.notes ?? "");
    setStatus((d.status as FilingStatus) ?? "draft");
    setSadadNumber(d.sadad_number ?? "");
    setSubmittedAt(d.submitted_at ? format(new Date(d.submitted_at), "yyyy-MM-dd") : "");
    setZatcaMode(!!d.zatca_mode);
  }, [savedQ.data, startISO, endISO]);

  const result = useMemo(
    () => computeVatReturn(salesQ.data ?? [], purchasesQ.data ?? [], expensesQ.data ?? [], adjustments),
    [salesQ.data, purchasesQ.data, expensesQ.data, adjustments],
  );

  const prevResult = useMemo(
    () => computeVatReturn(prevSalesQ.data ?? [], [], [], EMPTY_ADJUSTMENTS),
    [prevSalesQ.data],
  );

  // ---- Smart warnings ----
  const warnings = useMemo(() => {
    const list: { level: "warn" | "info"; title: string; msg: string }[] = [];
    const salesCount = (salesQ.data ?? []).length;
    const purchaseCount = (purchasesQ.data ?? []).length + (expensesQ.data ?? []).length;
    if (purchaseCount === 0) {
      list.push({ level: "warn", title: "No purchases found", msg: "Input VAT = 0. Verify that no purchase invoices or expenses are missing for this period." });
    }
    if (salesCount > 0 && result.totals.salesVat === 0) {
      list.push({ level: "warn", title: "Sales exist but VAT = 0", msg: "Likely a data issue - your sales transactions may be missing tax amounts." });
    }
    const prevSalesVat = prevResult.totals.salesVat;
    if (prevSalesVat > 0) {
      const delta = Math.abs(result.totals.salesVat - prevSalesVat) / prevSalesVat;
      if (delta > 0.3) {
        list.push({
          level: "info",
          title: `Large change vs previous period (${(delta * 100).toFixed(0)}%)`,
          msg: `Sales VAT moved from ${fmt(prevSalesVat)} to ${fmt(result.totals.salesVat)}. Confirm this matches your business activity.`,
        });
      }
    }
    const hasAnyAdj =
      adjustments.box14_corrections !== 0 ||
      adjustments.box15_credit_carried !== 0 ||
      Object.entries(adjustments).some(([k, v]) => k.endsWith("_adjustment") && Number(v) !== 0);
    if (hasAnyAdj && !notes.trim()) {
      list.push({ level: "warn", title: "Manual adjustments without a reason", msg: "Add a note explaining your adjustments before filing - this is logged for audit." });
    }
    return list;
  }, [salesQ.data, purchasesQ.data, expensesQ.data, result, prevResult, adjustments, notes]);

  // ---- Checklist ----
  const checklist = useMemo(() => {
    const items = [
      { key: "sales", label: "Sales transactions included", ok: !salesQ.isLoading && (salesQ.data?.length ?? 0) > 0 },
      { key: "purchases", label: "Purchase invoices captured", ok: !purchasesQ.isLoading && ((purchasesQ.data?.length ?? 0) + (expensesQ.data?.length ?? 0)) > 0 },
      { key: "vat", label: "No missing VAT values", ok: !(salesQ.data?.length && result.totals.salesVat === 0) },
      { key: "adjReviewed", label: "Adjustments reviewed (Boxes 8–10, 14)", ok: notes.trim().length > 0 || warnings.every((w) => !w.title.toLowerCase().includes("adjust")) },
      { key: "period", label: "Period validated", ok: end.getTime() < Date.now() },
    ];
    return items;
  }, [salesQ, purchasesQ, expensesQ, result, notes, warnings, end]);

  const allChecksOk = checklist.every((c) => c.ok);

  // ---- Mutations ----
  const saveMut = useMutation({
    mutationFn: async (overrideStatus?: FilingStatus) => {
      if (!restaurant?.id) throw new Error("No restaurant");
      const newStatus = overrideStatus ?? status;
      const payload: any = {
        restaurant_id: restaurant.id,
        tenant_id: (restaurant as any).tenant_id ?? null,
        period_start: startISO,
        period_end: endISO,
        box1_amount: result.sales.find((r) => r.key === "box1")!.amount,
        box7_amount: result.purchases.find((r) => r.key === "box7")!.amount,
        notes,
        zatca_mode: zatcaMode,
        status: newStatus,
        sadad_number: sadadNumber || null,
        submitted_at: submittedAt ? new Date(submittedAt).toISOString() : null,
        ...adjustments,
      };
      const { data: saved, error } = await db
        .from("vat_returns")
        .upsert(payload, { onConflict: "restaurant_id,period_start,period_end" })
        .select()
        .single();
      if (error) throw error;

      // Diff adjustments for audit log
      const prev = lastSavedAdjRef.current;
      const changed: { field_key: string; old_value: number; new_value: number }[] = [];
      for (const k of Object.keys(adjustments) as (keyof VatAdjustments)[]) {
        const a = Number(prev[k] ?? 0);
        const b = Number(adjustments[k] ?? 0);
        if (a !== b) changed.push({ field_key: k, old_value: a, new_value: b });
      }
      if (changed.length > 0) {
        const rows = changed.map((c) => ({
          ...c,
          vat_return_id: saved.id,
          restaurant_id: restaurant!.id,
          tenant_id: (restaurant as any).tenant_id ?? null,
          period_start: startISO,
          period_end: endISO,
          reason: adjReason || notes || null,
          changed_by: user?.id ?? null,
        }));
        await db.from("vat_return_adjustments_log").insert(rows);
      }
      lastSavedAdjRef.current = { ...adjustments };
      if (overrideStatus) setStatus(overrideStatus);
      return saved;
    },
    onSuccess: () => {
      toast.success("VAT return saved");
      setAdjReason("");
      queryClient.invalidateQueries({ queryKey: ["vat-return-saved"] });
      queryClient.invalidateQueries({ queryKey: ["vat-adj-log"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to save"),
  });

  const periodLabel = formatPeriodLabel(start, end);
  const periodCode = mode === "quarter" ? `Q${quarter} ${year}` : `${MONTHS[month]} ${year}`;
  const isLoading = salesQ.isLoading || purchasesQ.isLoading || expensesQ.isLoading;
  const labelOf = (r: BoxRow) => (arabicLabels && r.descriptionAr ? r.descriptionAr : r.description);

  const setAdj = (k: keyof VatAdjustments) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setAdjustments((a) => ({ ...a, [k]: Number(e.target.value) || 0 }));

  const handleExportPdf = () =>
    exportVatReturnPdf(result, {
      restaurantName: restaurant?.name ?? "Restaurant",
      periodStart: start,
      periodEnd: end,
      currency: (restaurant as any)?.currency ?? "SAR",
      arabic: arabicLabels,
      periodCode,
    });

  const handleExportCsv = () =>
    downloadCsv(`vat-return-${startISO}_to_${endISO}.csv`, buildVatReturnCsv(result));

  const dirRtl = arabicLabels;

  return (
    <>
      <div className={cn("container max-w-6xl py-6 space-y-6", dirRtl && "text-right")} dir={dirRtl ? "rtl" : "ltr"}>
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4 min-h-[56px]">
          <div className="min-w-[240px] flex-1"><div className="flex items-center gap-3">
              <h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight">
                {arabicLabels ? "إقرار ضريبة القيمة المضافة" : "VAT Return"}
              </h1>
              <Badge className={cn("text-xs px-2 py-0.5", STATUS_META[status].tone)}>
                {STATUS_META[status].label}
              </Badge>
              {zatcaMode && (
                <Badge variant="outline" className="text-xs gap-1">
                  <ShieldCheck className="h-3 w-3" /> ZATCA
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              {periodCode} · {periodLabel} · {arabicLabels ? "أساس الاستحقاق" : "Basis: Accrual"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 mr-2">
              <Switch id="zatca-mode" checked={zatcaMode} onCheckedChange={setZatcaMode} />
              <Label htmlFor="zatca-mode" className="text-xs cursor-pointer">ZATCA Filing Mode</Label>
            </div>
            <div className="flex items-center gap-2 mr-2">
              <Switch id="ar-mode" checked={arabicLabels} onCheckedChange={setArabicLabels} />
              <Label htmlFor="ar-mode" className="text-xs cursor-pointer">العربية</Label>
            </div>
            <ZatcaMappingSheet />
            <Button variant="outline" size="sm" onClick={handleExportCsv} disabled={isLoading}>
              <Download className="h-4 w-4 mr-2" /> CSV
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportPdf} disabled={isLoading}>
              <FileText className="h-4 w-4 mr-2" /> PDF
            </Button>
            <Button size="sm" onClick={() => saveMut.mutate(undefined)} disabled={saveMut.isPending || isLoading}>
              <Save className="h-4 w-4 mr-2" /> {saveMut.isPending ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>

        {/* Period selector */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-wrap items-end gap-4">
              <Tabs value={mode} onValueChange={(v) => setMode(v as PeriodMode)}>
                <TabsList>
                  <TabsTrigger value="quarter">Quarterly</TabsTrigger>
                  <TabsTrigger value="month">Monthly</TabsTrigger>
                </TabsList>
              </Tabs>
              {mode === "quarter" ? (
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Quarter</Label>
                  <Select value={String(quarter)} onValueChange={(v) => setQuarter(Number(v) as 1 | 2 | 3 | 4)}>
                    <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">Q1 (Jan–Mar)</SelectItem>
                      <SelectItem value="2">Q2 (Apr–Jun)</SelectItem>
                      <SelectItem value="3">Q3 (Jul–Sep)</SelectItem>
                      <SelectItem value="4">Q4 (Oct–Dec)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Month</Label>
                  <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
                    <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {MONTHS.map((m, i) => (
                        <SelectItem key={i} value={String(i)}>{m}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Year</Label>
                <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
                  <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 5 }, (_, i) => now.getFullYear() - i).map((y) => (
                      <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Stepper */}
        <Stepper current={step} onSelect={setStep} />

        {/* Input VAT ledger reconciliation */}
        <VatRecoverableReconciliationPanel
          restaurantId={restaurant?.id}
          dateFrom={startISO}
          dateTo={endISO}
        />

        {/* VAT remittance / payment to the tax authority */}
        <VatRemittancePanel
          restaurantId={restaurant?.id}
          periodStart={startISO}
          periodEnd={endISO}
          vatReturnId={(savedQ.data as any)?.id ?? null}
        />

        {/* Smart warnings */}
        {warnings.length > 0 && (
          <div className="space-y-2">
            {warnings.map((w, i) => (
              <Alert key={i} variant={w.level === "warn" ? "destructive" : "default"}>
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>{w.title}</AlertTitle>
                <AlertDescription>{w.msg}</AlertDescription>
              </Alert>
            ))}
          </div>
        )}

        {/* Step content */}
        {step === 1 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium">1. Data completeness</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Stat label="Sales transactions" value={salesQ.data?.length ?? 0} />
                <Stat label="Purchase invoices" value={purchasesQ.data?.length ?? 0} />
                <Stat label="Expense entries" value={expensesQ.data?.length ?? 0} />
              </div>
              <ul className="space-y-2 mt-4">
                {checklist.map((c) => (
                  <li key={c.key} className="flex items-center gap-2 text-sm">
                    {c.ok ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    ) : (
                      <Circle className="h-4 w-4 text-muted-foreground" />
                    )}
                    <span className={c.ok ? "" : "text-muted-foreground"}>{c.label}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {step === 2 && (
          <>
            <SectionCard
              title={arabicLabels ? "ضريبة القيمة المضافة على المبيعات" : "VAT on Sales"}
              loading={isLoading}
              rows={result.sales}
              labelOf={labelOf}
              totals={{
                number: "6",
                description: arabicLabels ? "إجمالي المبيعات" : "Total Sales",
                amount: result.totals.salesAmount,
                adjustment: result.totals.salesAdjustment,
                vat: result.totals.salesVat,
              }}
              adjustments={adjustments}
              setAdj={setAdj}
              readOnly
            />
            <SectionCard
              title={arabicLabels ? "ضريبة القيمة المضافة على المشتريات" : "VAT on Purchases"}
              loading={isLoading}
              rows={result.purchases}
              labelOf={labelOf}
              totals={{
                number: "12",
                description: arabicLabels ? "إجمالي المشتريات" : "Total purchases",
                amount: result.totals.purchasesAmount,
                adjustment: result.totals.purchasesAdjustment,
                vat: result.totals.purchasesVat,
              }}
              adjustments={adjustments}
              setAdj={setAdj}
              readOnly
            />
          </>
        )}

        {step === 3 && (
          <>
            <SectionCard
              title={arabicLabels ? "ضريبة القيمة المضافة على المبيعات" : "VAT on Sales"}
              loading={isLoading}
              rows={result.sales}
              labelOf={labelOf}
              totals={{
                number: "6",
                description: arabicLabels ? "إجمالي المبيعات" : "Total Sales",
                amount: result.totals.salesAmount,
                adjustment: result.totals.salesAdjustment,
                vat: result.totals.salesVat,
              }}
              adjustments={adjustments}
              setAdj={setAdj}
            />
            <SectionCard
              title={arabicLabels ? "ضريبة القيمة المضافة على المشتريات" : "VAT on Purchases"}
              loading={isLoading}
              rows={result.purchases}
              labelOf={labelOf}
              totals={{
                number: "12",
                description: arabicLabels ? "إجمالي المشتريات" : "Total purchases",
                amount: result.totals.purchasesAmount,
                adjustment: result.totals.purchasesAdjustment,
                vat: result.totals.purchasesVat,
              }}
              adjustments={adjustments}
              setAdj={setAdj}
            />

            {/* Net VAT block (Boxes 13–16) */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-medium">Net VAT due</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-muted-foreground text-xs uppercase tracking-wide">
                        <th className="text-left py-2 pr-4 w-16">Box#</th>
                        <th className="text-left py-2 pr-4">Description</th>
                        <th className="text-right py-2 pl-4 w-48">VAT Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b">
                        <td className="py-2 pr-4">13</td>
                        <td className="py-2 pr-4">Total VAT due for current period</td>
                        <td className="py-2 pl-4 text-right tabular-nums">{fmt(result.totals.netVatBeforeCorrections)}</td>
                      </tr>
                      <tr className="border-b">
                        <td className="py-2 pr-4">14</td>
                        <td className="py-2 pr-4">Corrections from previous period (between SAR -15,000 and SAR 15,000)</td>
                        <td className="py-2 pl-4 text-right">
                          <Input type="number" step="0.01" value={adjustments.box14_corrections} onChange={setAdj("box14_corrections")} className="h-8 text-right tabular-nums w-40 ml-auto" />
                        </td>
                      </tr>
                      <tr className="border-b">
                        <td className="py-2 pr-4">15</td>
                        <td className="py-2 pr-4">VAT credit carried forward from previous period(s)</td>
                        <td className="py-2 pl-4 text-right">
                          <Input type="number" step="0.01" value={adjustments.box15_credit_carried} onChange={setAdj("box15_credit_carried")} className="h-8 text-right tabular-nums w-40 ml-auto" />
                        </td>
                      </tr>
                      <tr className="bg-muted/40 font-medium">
                        <td className="py-3 pr-4">16</td>
                        <td className="py-3 pr-4">Net VAT due (or claim)</td>
                        <td className="py-3 pl-4 text-right tabular-nums text-primary">{fmt(result.totals.netVatDue)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Reason for adjustments (logged for audit)</Label>
                    <Input
                      value={adjReason}
                      onChange={(e) => setAdjReason(e.target.value)}
                      placeholder="e.g. correcting Q4 invoice posted in wrong month"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Notes</Label>
                    <Textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Add any internal notes for this filing..."
                      rows={2}
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between mt-4">
                  <Button variant="ghost" size="sm" onClick={() => { setAdjustments(EMPTY_ADJUSTMENTS); setNotes(""); }}>
                    <RotateCcw className="h-3.5 w-3.5 mr-2" /> Reset adjustments
                  </Button>
                  <p className="text-xs text-muted-foreground">Amount is displayed in your base currency.</p>
                </div>
              </CardContent>
            </Card>
          </>
        )}

        {step === 4 && (
          <FinalReview
            arabic={arabicLabels}
            periodCode={periodCode}
            periodLabel={periodLabel}
            result={result}
            checklistOk={allChecksOk}
            status={status}
            sadadNumber={sadadNumber}
            submittedAt={submittedAt}
            onSadadChange={setSadadNumber}
            onSubmittedAtChange={setSubmittedAt}
            onMarkReady={() => saveMut.mutate("ready")}
            onMarkSubmitted={() => saveMut.mutate("submitted")}
            onMarkPaid={() => saveMut.mutate("paid")}
            onExportPdf={handleExportPdf}
          />
        )}

        {/* Stepper navigation */}
        <div className="flex justify-between">
          <Button variant="outline" size="sm" disabled={step === 1} onClick={() => setStep((s) => Math.max(1, s - 1))}>
            <ArrowLeft className="h-4 w-4 mr-2" /> Back
          </Button>
          <Button size="sm" disabled={step === 4} onClick={() => setStep((s) => Math.min(4, s + 1))}>
            Next <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        </div>

        {/* Audit log */}
        <AuditLog rows={auditQ.data ?? []} />
      </div>
    </>
  );
}

/* ---------------- Stepper ---------------- */

function Stepper({ current, onSelect }: { current: number; onSelect: (n: number) => void }) {
  return (
    <div className="flex items-center gap-2 sm:gap-4 overflow-x-auto py-2">
      {STEPS.map((s, i) => {
        const active = current === s.id;
        const done = current > s.id;
        return (
          <div key={s.id} className="flex items-center gap-2 sm:gap-4 shrink-0">
            <button
              type="button"
              onClick={() => onSelect(s.id)}
              className={cn(
                "flex items-center gap-2 rounded-full px-3 py-1.5 text-sm transition-colors",
                active && "bg-primary text-primary-foreground",
                !active && done && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
                !active && !done && "bg-muted text-muted-foreground hover:text-foreground",
              )}
            >
              <span className={cn(
                "h-5 w-5 rounded-full grid place-items-center text-[11px] font-medium",
                active ? "bg-primary-foreground/20" : done ? "bg-emerald-500/20" : "bg-foreground/10",
              )}>
                {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : s.id}
              </span>
              <span className="hidden sm:inline">{s.label}</span>
            </button>
            {i < STEPS.length - 1 && <div className="h-px w-6 sm:w-10 bg-border" />}
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- ZATCA Mapping Sheet ---------------- */

function ZatcaMappingSheet() {
  const map: { box: string; en: string; meaning: string }[] = [
    { box: "Box 1", en: "Standard rated sales (15%)", meaning: "Your POS sales - what you charged customers." },
    { box: "Box 2", en: "Special citizen sales", meaning: "Healthcare / education / first-home VAT borne by govt." },
    { box: "Box 3", en: "Zero rated sales", meaning: "Goods/services taxed at 0% (rare for restaurants)." },
    { box: "Box 4", en: "Exports", meaning: "Sales outside KSA." },
    { box: "Box 5", en: "Exempt sales", meaning: "Sales not subject to VAT." },
    { box: "Box 6", en: "Total Sales", meaning: "Sum of Boxes 1–5 - for reference only." },
    { box: "Box 7", en: "Standard rated purchases (15%)", meaning: "Your purchase invoices and expenses with VAT." },
    { box: "Box 8", en: "Imports - VAT at customs", meaning: "Imports where you paid VAT to customs." },
    { box: "Box 9", en: "Imports - reverse charge", meaning: "Imports where you self-account VAT (Phase 2 e-invoice)." },
    { box: "Box 10", en: "Zero rated purchases", meaning: "Purchases taxed at 0%." },
    { box: "Box 11", en: "Exempt purchases", meaning: "Purchases without VAT." },
    { box: "Box 12", en: "Total Purchases", meaning: "Sum of Boxes 7–11." },
    { box: "Box 13", en: "VAT due for the period", meaning: "Output VAT (sales) − Input VAT (purchases)." },
    { box: "Box 14", en: "Corrections", meaning: "Fixes from a prior return (limit ±SAR 15,000)." },
    { box: "Box 15", en: "Credit carried forward", meaning: "Refund credit from previous returns applied here." },
    { box: "Box 16", en: "Net VAT due (or claim)", meaning: "What you pay via SADAD - or claim back." },
  ];
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm">
          <BookOpen className="h-4 w-4 mr-2" /> Box guide
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>How this maps to ZATCA</SheetTitle>
          <SheetDescription>Plain-English explanation of each ZATCA box.</SheetDescription>
        </SheetHeader>
        <ScrollArea className="h-[calc(100vh-7rem)] mt-4 pr-2">
          <div className="space-y-3 pb-6">
            {map.map((m) => (
              <div key={m.box} className="border rounded-md p-3">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[11px]">{m.box}</Badge>
                  <span className="text-sm font-medium">{m.en}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{m.meaning}</p>
              </div>
            ))}
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription className="text-xs">
                Future-ready: this report is structured to support direct ZATCA API submission and Phase 2 e-invoicing.
              </AlertDescription>
            </Alert>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

/* ---------------- Final Review ---------------- */

function FinalReview(props: {
  arabic: boolean;
  periodCode: string;
  periodLabel: string;
  result: ReturnType<typeof computeVatReturn>;
  checklistOk: boolean;
  status: FilingStatus;
  sadadNumber: string;
  submittedAt: string;
  onSadadChange: (v: string) => void;
  onSubmittedAtChange: (v: string) => void;
  onMarkReady: () => void;
  onMarkSubmitted: () => void;
  onMarkPaid: () => void;
  onExportPdf: () => void;
}) {
  const { result, periodCode, periodLabel, checklistOk, status } = props;
  const payable = result.totals.netVatDue;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium">
          {payable >= 0 ? "Ready to submit to ZATCA" : "Refund claim ready"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="rounded-lg border bg-muted/20 p-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Period</p>
              <p className="text-lg font-light mt-0.5">{periodCode}</p>
              <p className="text-xs text-muted-foreground">{periodLabel}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">
                {payable >= 0 ? "VAT Payable" : "VAT Refund"}
              </p>
              <p className="text-3xl font-light tracking-tight tabular-nums mt-0.5">
                SAR {fmt(Math.abs(payable))}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 mt-5 text-sm">
            <Stat label="Output VAT" value={fmt(result.totals.salesVat)} prefix="SAR" />
            <Stat label="Input VAT" value={fmt(result.totals.purchasesVat)} prefix="SAR" />
            <Stat label="Adjustments" value={fmt(result.corrections - result.creditCarried)} prefix="SAR" />
          </div>
        </div>

        {!checklistOk && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Some checks are not complete</AlertTitle>
            <AlertDescription>
              Go back to step 1 to confirm data completeness before marking as Ready.
            </AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">SADAD number (optional)</Label>
            <Input value={props.sadadNumber} onChange={(e) => props.onSadadChange(e.target.value)} placeholder="e.g. 12345678901234" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Submission date</Label>
            <Input type="date" value={props.submittedAt} onChange={(e) => props.onSubmittedAtChange(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Current status</Label>
            <div className="h-9 flex items-center">
              <Badge className={cn("text-xs", STATUS_META[status].tone)}>{STATUS_META[status].label}</Badge>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={props.onExportPdf}>
            <Download className="h-4 w-4 mr-2" /> Download ZATCA-ready PDF
          </Button>
          <Button
            variant="outline"
            onClick={() => window.open("https://zatca.gov.sa", "_blank", "noopener,noreferrer")}
            title="Indirect Taxes → VAT → Returns → File Return"
          >
            <ExternalLink className="h-4 w-4 mr-2" /> Open ZATCA Portal
          </Button>
          {status === "draft" && (
            <Button variant="secondary" onClick={props.onMarkReady} disabled={!checklistOk}>
              Mark as Ready
            </Button>
          )}
          {status === "ready" && (
            <Button variant="secondary" onClick={props.onMarkSubmitted}>
              Mark as Submitted
            </Button>
          )}
          {status === "submitted" && (
            <Button variant="secondary" onClick={props.onMarkPaid}>
              Mark as Paid
            </Button>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          On the ZATCA portal: <span className="font-medium">Indirect Taxes → VAT → Returns → File Return</span>.
        </p>
      </CardContent>
    </Card>
  );
}

/* ---------------- Audit Log ---------------- */

function AuditLog({ rows }: { rows: any[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button className="w-full flex items-center justify-between p-4 text-left">
            <div className="flex items-center gap-2">
              <History className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Audit log</span>
              <Badge variant="outline" className="text-[11px]">{rows.length}</Badge>
            </div>
            <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="px-4 pb-4">
            {rows.length === 0 ? (
              <p className="text-xs text-muted-foreground">No manual adjustments recorded yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-muted-foreground uppercase tracking-wide">
                      <th className="text-left py-2 pr-4">When</th>
                      <th className="text-left py-2 pr-4">Field</th>
                      <th className="text-right py-2 pr-4">Old</th>
                      <th className="text-right py-2 pr-4">New</th>
                      <th className="text-left py-2 pr-4">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className="border-b">
                        <td className="py-2 pr-4 whitespace-nowrap">{format(new Date(r.created_at), "PP p")}</td>
                        <td className="py-2 pr-4 font-mono">{r.field_key}</td>
                        <td className="py-2 pr-4 text-right tabular-nums">{fmt(Number(r.old_value ?? 0))}</td>
                        <td className="py-2 pr-4 text-right tabular-nums">{fmt(Number(r.new_value ?? 0))}</td>
                        <td className="py-2 pr-4 text-muted-foreground">{r.reason ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

/* ---------------- Tiny stat block ---------------- */

function Stat({ label, value, prefix }: { label: string; value: number | string; prefix?: string }) {
  return (
    <div className="rounded-md border bg-background p-3">
      <p className="text-[11px] text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className="text-lg font-light tabular-nums mt-1">
        {prefix && <span className="text-xs text-muted-foreground mr-1">{prefix}</span>}
        {value}
      </p>
    </div>
  );
}

/* ---------------- Section card (sales / purchases) ---------------- */

function SectionCard({
  title,
  loading,
  rows,
  totals,
  adjustments,
  setAdj,
  labelOf,
  readOnly = false,
}: {
  title: string;
  loading: boolean;
  rows: BoxRow[];
  totals: { number: string; description: string; amount: number; adjustment: number; vat: number };
  adjustments: VatAdjustments;
  setAdj: (k: keyof VatAdjustments) => (e: React.ChangeEvent<HTMLInputElement>) => void;
  labelOf: (r: BoxRow) => string;
  readOnly?: boolean;
}) {
  const adjKey = (boxKey: string): keyof VatAdjustments => `${boxKey}_adjustment` as any;
  const amtKey = (boxKey: string): keyof VatAdjustments => `${boxKey}_amount` as any;
  const autoBoxes = new Set(["box1", "box7"]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground text-xs uppercase tracking-wide">
                  <th className="text-left py-2 pr-4 w-16">Box#</th>
                  <th className="text-left py-2 pr-4">Description</th>
                  <th className="text-right py-2 pl-4 w-40">Amount</th>
                  <th className="text-right py-2 pl-4 w-40">Adjustment</th>
                  <th className="text-right py-2 pl-4 w-36">VAT Amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className="border-b">
                    <td className="py-2 pr-4 align-middle">{r.number}</td>
                    <td className="py-2 pr-4 align-middle">{labelOf(r)}</td>
                    <td className="py-2 pl-4 text-right align-middle">
                      {autoBoxes.has(r.key) || readOnly ? (
                        <span className="tabular-nums">{fmt(r.amount)}</span>
                      ) : (
                        <Input type="number" step="0.01" value={adjustments[amtKey(r.key)] as number} onChange={setAdj(amtKey(r.key))} className="h-8 text-right tabular-nums w-32 ml-auto" />
                      )}
                    </td>
                    <td className="py-2 pl-4 text-right align-middle">
                      {readOnly ? (
                        <span className="tabular-nums">{fmt(r.adjustment)}</span>
                      ) : (
                        <Input type="number" step="0.01" value={adjustments[adjKey(r.key)] as number} onChange={setAdj(adjKey(r.key))} className="h-8 text-right tabular-nums w-32 ml-auto" />
                      )}
                    </td>
                    <td className="py-2 pl-4 text-right tabular-nums align-middle">
                      {r.vatRate != null ? fmt((r.amount + r.adjustment) * r.vatRate) : ""}
                    </td>
                  </tr>
                ))}
                <tr className="bg-muted/40 font-medium">
                  <td className="py-3 pr-4">{totals.number}</td>
                  <td className="py-3 pr-4">{totals.description}</td>
                  <td className="py-3 pl-4 text-right tabular-nums">{fmt(totals.amount)}</td>
                  <td className="py-3 pl-4 text-right tabular-nums">{fmt(totals.adjustment)}</td>
                  <td className="py-3 pl-4 text-right tabular-nums">{fmt(totals.vat)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}