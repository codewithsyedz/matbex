import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import { AlertTriangle, ArrowUpRight, ClipboardCheck, Package, Percent, Plus, RefreshCw, Wallet } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useCurrency } from "@/hooks/useCurrency";
import { getFiscalMonthRange, useFiscalSettings } from "@/hooks/useFiscalSettings";
import { getTenantTodayDate } from "@/lib/timezone";
import { expenseAttention, summarizeAccountantExpenses } from "@/lib/accountantDashboard";
import { useAccountantDashboard } from "@/hooks/useAccountantDashboard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RecordExpenseDialog } from "@/components/expenses/RecordExpenseDialog";
import { QuickAddInventoryItemDialog } from "@/components/expenses/QuickAddInventoryItemDialog";
import { RouteSeo } from "@/components/seo/RouteSeo";
import { db } from "@/integrations/db/client";

export default function AccountantDashboard() {
  const { i18n } = useTranslation(); const ar = i18n.language.startsWith("ar");
  const L = (en: string, arabic: string) => ar ? arabic : en;
  const { restaurant } = useAuth();
  const { activeBranchId, pinnedBranchId, branches, canSwitchBranches, setActiveBranchId } = useBranch();
  const { monthStartDay } = useFiscalSettings();
  const { format: money, baseCurrency } = useCurrency();
  const fiscal = getFiscalMonthRange(getTenantTodayDate(restaurant?.timezone || "Asia/Riyadh"), monthStartDay);
  const [customFrom, setFrom] = useState<string | null>(null); const [customTo, setTo] = useState<string | null>(null);
  const from = customFrom || format(fiscal.start, "yyyy-MM-dd"); const to = customTo || format(fiscal.end, "yyyy-MM-dd");
  const branch = pinnedBranchId || (activeBranchId === "all" ? null : activeBranchId);
  const query = useAccountantDashboard(branch, from, to);
  const [emailStatus, setEmailStatus] = useState<string | null>(null);
  useEffect(() => {
    if (!query.dataUpdatedAt || restaurant?.id !== "fe1a4d9e-1595-43ba-a47a-37575a9a55b9") return;
    let cancelled = false;
    db.functions.invoke("accountant-pending-alerts", { body: {} }).then(({data,error}) => {
      if (!cancelled) setEmailStatus(error ? "error" : data?.status || null);
    });
    return () => { cancelled = true; };
  }, [query.dataUpdatedAt, restaurant?.id]);
  const [expenseOpen, setExpenseOpen] = useState(false); const [itemOpen, setItemOpen] = useState(false);
  const [reviewFilter, setReviewFilter] = useState("all");
  const data = query.data;
  const totals = summarizeAccountantExpenses(data?.expenses || [], from, to);
  const pending = (data?.expenses || []).filter(e => expenseAttention(e)).sort((a,b) => b.expense_date.localeCompare(a.expense_date));
  const filteredPending = pending.filter(e => reviewFilter === "all" || expenseAttention(e) === reviewFilter);
  const lowStock = (data?.inventory || []).filter(i => i.reorder_level !== null && Number(i.current_stock) <= Number(i.reorder_level));
  const scope = new URLSearchParams({ from, to, branch: branch || "all" }).toString();
  // Sales missing from the ledger (all dates): closed days not posted, and days with POS sales
  // but no End of Day. Until fixed, revenue, VAT and cash in the books are short.
  const missingSales = useQuery({
    queryKey: ["accountant-missing-sales", restaurant?.id, branch],
    enabled: !!restaurant?.id,
    staleTime: 60_000,
    queryFn: async () => {
      let q = db.from("daily_sales_summary").select("total_sales")
        .eq("restaurant_id", restaurant!.id).in("status", ["closed", "approved"])
        .or("ledger_posted.is.null,ledger_posted.eq.false");
      if (branch) q = q.eq("branch_id", branch);
      const [unposted, noEod] = await Promise.all([
        q,
        db.rpc("days_without_end_of_day" as never, { p_restaurant_id: restaurant!.id, p_branch_id: branch } as never),
      ]);
      if (unposted.error) throw unposted.error;
      if (noEod.error) throw noEod.error;
      const u = (unposted.data || []) as Array<{ total_sales: number }>;
      const n = ((noEod.data || []) as unknown) as Array<{ pos_total: number }>;
      return {
        unpostedDays: u.length, unpostedTotal: u.reduce((s, r) => s + Number(r.total_sales || 0), 0),
        noEodDays: n.length, noEodTotal: n.reduce((s, r) => s + Number(r.pos_total || 0), 0),
      };
    },
  });
  const ms = missingSales.data;
  const reasons = { mapping: L("Account missing", "حساب مفقود"), posting: L("Awaiting posting", "بانتظار الترحيل"), approval: L("Awaiting approval", "بانتظار الموافقة"), vat: L("VAT review", "مراجعة الضريبة") };
  const tiles = [
    { label: L("Input VAT · posted", "ضريبة المدخلات · مرحّلة"), value: money(data?.postedInputVat || 0), detail: L("Expense VAT recorded", "ضريبة المصروفات المسجلة") + " · " + money(totals.vat), icon: Percent, path: "/reports/vat-audit" },
    { label: L("Expenses", "المصروفات"), value: money(totals.total), detail: L("Outstanding", "المتبقي") + " · " + money(totals.unpaid), icon: Wallet, path: "/expenses" },
    { label: L("Inventory · current", "المخزون · الحالي"), value: String(data?.inventory.length || 0), detail: `${lowStock.length} ${L("low-stock items", "أصناف منخفضة المخزون")}`, icon: Package, path: "/inventory" },
    { label: L("Pending corrections", "التصحيحات المعلقة"), value: String(pending.length), detail: L("All dates · selected branch", "جميع التواريخ · الفرع المحدد"), icon: ClipboardCheck, path: "#corrections" },
  ];
  return <div className="container mx-auto max-w-7xl py-6 space-y-6" dir={ar ? "rtl" : "ltr"}>
    <RouteSeo title="Accountant Dashboard | Matbex" description="VAT, expenses, inventory and pending accounting reviews." path="/dashboard" noindex />
    <header className="flex flex-wrap justify-between items-start gap-4">
      <div><h1 className="font-display text-2xl font-semibold">{L("Accountant dashboard", "لوحة المحاسب")}</h1><p className="text-sm text-muted-foreground mt-1">{restaurant?.name} · {baseCurrency}</p></div>
      <div className="flex flex-wrap gap-2"><Button variant="outline" size="icon" aria-label={L("Refresh dashboard", "تحديث اللوحة")} title={L("Refresh dashboard", "تحديث اللوحة")} disabled={query.isFetching} onClick={() => query.refetch()}><RefreshCw className="h-4 w-4" /></Button>
        <Button variant="outline" onClick={() => setItemOpen(true)}><Plus className="h-4 w-4 me-2" />{L("Add inventory", "إضافة مخزون")}</Button>
        <Button onClick={() => setExpenseOpen(true)}><Plus className="h-4 w-4 me-2" />{L("Record expense", "تسجيل مصروف")}</Button></div>
    </header>
    {restaurant?.id === "fe1a4d9e-1595-43ba-a47a-37575a9a55b9" && <p role="status" className="text-sm text-muted-foreground">{emailStatus === "error" ? L("Accounting alert could not be sent. Refresh to retry.", "تعذر إرسال تنبيه الحسابات. حدّث لإعادة المحاولة.") : emailStatus === "suppressed" ? L("Email alerts are blocked for dev@matbex.com by its email preferences or delivery status.", "تنبيهات البريد إلى dev@matbex.com محظورة بسبب التفضيلات أو حالة التسليم.") : L("Email alerts: dev@matbex.com · checked when this dashboard opens or refreshes", "تنبيهات البريد: dev@matbex.com · يتم التحقق عند فتح اللوحة أو تحديثها")}</p>}
    <div className="flex flex-wrap gap-3 items-end border-y py-4">
      <div className="space-y-1"><Label>{L("Branch", "الفرع")}</Label><Select value={branch || "all"} disabled={!canSwitchBranches} onValueChange={setActiveBranchId}><SelectTrigger className="w-[210px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">{L("All branches", "جميع الفروع")}</SelectItem>{branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent></Select></div>
      <div className="space-y-1"><Label htmlFor="accountant-from">{L("From", "من")}</Label><Input id="accountant-from" type="date" value={from} max={to} onChange={e => setFrom(e.target.value || null)} /></div>
      <div className="space-y-1"><Label htmlFor="accountant-to">{L("To", "إلى")}</Label><Input id="accountant-to" type="date" value={to} min={from} onChange={e => setTo(e.target.value || null)} /></div>
    </div>
    {query.isError ? <div role="alert" className="border border-destructive p-4 text-destructive">{L("Could not load accounting data", "تعذر تحميل بيانات الحسابات")}<Button variant="outline" className="ms-3" onClick={() => query.refetch()}>{L("Retry", "إعادة المحاولة")}</Button></div> : <>
    {ms && (ms.unpostedDays > 0 || ms.noEodDays > 0) && <div role="alert" className="rounded-md border border-amber-500/40 bg-amber-500/10 p-4 space-y-2">
      <p className="font-medium flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-600" />{L("Sales missing from the ledger", "مبيعات غير مرحّلة إلى الدفتر")}</p>
      <p className="text-sm text-muted-foreground">{L("Until these are fixed, revenue, VAT and cash in the books are short. All dates, selected branch.", "حتى تُعالج، تكون الإيرادات والضريبة والنقد في الدفاتر ناقصة. جميع التواريخ، الفرع المحدد.")}</p>
      <ul className="text-sm space-y-1">
        {ms.unpostedDays > 0 && <li className="flex flex-wrap items-center gap-2">{L(`${ms.unpostedDays} closed day(s) not posted`, `${ms.unpostedDays} يوم مغلق غير مرحّل`)} · <span className="font-medium tabular-nums">{money(ms.unpostedTotal)}</span> <Link className="text-primary underline" to="/daily-profit">{L("Post them", "ترحيلها")}</Link></li>}
        {ms.noEodDays > 0 && <li className="flex flex-wrap items-center gap-2">{L(`${ms.noEodDays} day(s) with sales but no End of Day`, `${ms.noEodDays} يوم فيه مبيعات بلا إقفال يومي`)} · <span className="font-medium tabular-nums">{money(ms.noEodTotal)}</span> <Link className="text-primary underline" to="/sales">{L("Close them in Sales → Day-End", "أقفلها من المبيعات ← نهاية اليوم")}</Link></li>}
      </ul>
    </div>}
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">{tiles.map(tile => <a key={tile.path} href={tile.path.startsWith("#") ? tile.path : `${tile.path}?${scope}`} className="rounded-md border bg-card p-4 flex flex-col gap-3 hover:border-primary focus-visible:outline focus-visible:outline-primary min-w-0">
      <span className="flex items-center justify-between text-sm text-muted-foreground"><span className="flex gap-2 items-center"><tile.icon className="h-4 w-4 text-primary" />{tile.label}</span><ArrowUpRight className="h-4 w-4 shrink-0" /></span>
      {query.isLoading ? <Skeleton className="h-8 w-32" /> : <span className="text-2xl font-semibold tabular-nums break-words">{tile.value}</span>}<span className="text-xs text-muted-foreground">{tile.detail}</span>
    </a>)}</div>
    <section id="corrections" className="space-y-3">
      <Select value={reviewFilter} onValueChange={setReviewFilter}><SelectTrigger className="w-[220px]" aria-label={L("Filter reviews", "تصفية المراجعات")}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">{L("All reviews", "جميع المراجعات")}</SelectItem>{Object.entries(reasons).map(([key,label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectContent></Select>
      <div className="flex justify-between gap-2 items-center"><h2 className="text-lg font-semibold">{L("Corrections & reviews", "التصحيحات والمراجعات")} <Badge variant="secondary">{pending.length}</Badge></h2><Button asChild variant="ghost" size="sm"><Link to={`/reports/expense-ledger-reconciliation?${scope}`}>{L("Ledger reconciliation", "مطابقة دفتر الأستاذ")}<ArrowUpRight className="h-4 w-4 ms-2" /></Link></Button></div>
      <div className="overflow-x-auto border rounded-md"><Table><TableHeader><TableRow><TableHead>{L("Date", "التاريخ")}</TableHead><TableHead>{L("Expense", "المصروف")}</TableHead><TableHead>{L("Branch", "الفرع")}</TableHead><TableHead>{L("Review", "المراجعة")}</TableHead><TableHead className="text-end">{L("Amount", "المبلغ")}</TableHead><TableHead /></TableRow></TableHeader><TableBody>
        {query.isLoading ? <TableRow><TableCell colSpan={6}><Skeleton className="h-24 w-full" /></TableCell></TableRow> : filteredPending.slice(0,30).map(e => { const reason = expenseAttention(e); return <TableRow key={e.id}><TableCell className="whitespace-nowrap">{e.expense_date}</TableCell><TableCell className="min-w-[180px] max-w-[360px] break-words">{e.description || "—"}</TableCell><TableCell>{branches.find(b => b.id === e.branch_id)?.name || L("Unassigned", "غير محدد")}</TableCell><TableCell><Badge variant="outline">{reason ? reasons[reason] : "—"}</Badge></TableCell><TableCell className="text-end whitespace-nowrap tabular-nums">{money(Number(e.amount))}</TableCell><TableCell><Button asChild variant="ghost" size="sm"><Link to={`/expenses?expense=${e.id}&branch=${e.branch_id || "all"}`}>{L("Review", "مراجعة")}<ArrowUpRight className="h-4 w-4 ms-1" /></Link></Button></TableCell></TableRow> })}
        {!query.isLoading && !filteredPending.length && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">{L("No pending corrections", "لا توجد تصحيحات معلقة")}</TableCell></TableRow>}
      </TableBody></Table></div>
      {pending.length > 30 && <Button asChild variant="outline"><Link to={`/expenses?branch=${branch || "all"}`}>{L("View all expenses", "عرض جميع المصروفات")}</Link></Button>}
    </section>
    <section className="border-t pt-5 flex flex-wrap gap-2"><Button asChild variant="outline"><Link to={`/expenses/pending-vat-split?${scope}`}>{L("Pending VAT splits", "تقسيم الضريبة المعلق")}</Link></Button><Button asChild variant="outline"><Link to={`/inventory?${scope}`}>{L("Inventory", "المخزون")}</Link></Button><Button asChild variant="outline"><Link to={`/reports/profit-loss?${scope}`}>{L("Profit & Loss", "الأرباح والخسائر")}</Link></Button><Button asChild variant="outline"><Link to={`/accounting?${scope}`}>{L("Chart of accounts", "دليل الحسابات")}</Link></Button></section>
    </>}
    <RecordExpenseDialog open={expenseOpen} onOpenChange={open => { setExpenseOpen(open); if (!open) query.refetch(); }} />
    <QuickAddInventoryItemDialog open={itemOpen} onOpenChange={setItemOpen} restaurantId={restaurant?.id} onCreated={() => query.refetch()} />
  </div>;
}