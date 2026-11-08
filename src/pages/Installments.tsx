import { useMemo, useState } from "react";
import { format } from "date-fns";
import {
  AlertTriangle,
  Banknote,
  CalendarClock,
  Download,
  Landmark,
  History,
  Paperclip,
  Pencil,
  Plus,
  RotateCcw,
  Wallet,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";

import { BranchScopeSelector } from "@/components/branches/BranchScopeSelector";
import { useBranch } from "@/contexts/BranchContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { InvoiceImageUploader } from "@/components/inventory/InvoiceImageUploader";
import { useFixedAssets } from "@/hooks/useFixedAssets";
import { useCurrency } from "@/hooks/useCurrency";
import { DepreciationSchedulePreview } from "@/components/accounting/DepreciationSchedulePreview";
import { FinanceChargeComparison } from "@/components/accounting/FinanceChargeComparison";
import { InvoiceActions } from "@/components/accounting/InvoiceActions";
import { InstallmentAuditTrailDialog } from "@/components/accounting/InstallmentAuditTrail";
import { useChartOfAccounts } from "@/hooks/useChartOfAccounts";
import { useOwnerCapital } from "@/hooks/useOwnerCapital";
import {
  useInstallmentPlans,
  type InstallmentFrequency,
  type InstallmentProvider,
  type PlanSummary,
} from "@/hooks/useInstallmentPlans";
import { exportToCSV } from "@/lib/exportUtils";
import { useBranchVatRate } from "@/hooks/useBranchVatRate";
import { splitInstallmentPurchase } from "@/lib/installmentVatSplit";
import { checkInstallmentIntegrity } from "@/lib/installmentIntegrity";
import { InstallmentIntegrityChecklist } from "@/components/accounting/InstallmentIntegrityChecklist";
import { useInstallmentLedgerTotals } from "@/hooks/useInstallmentLedgerTotals";
import { toast } from "sonner";

const PROVIDERS: { value: InstallmentProvider; label: string }[] = [
  { value: "tabby", label: "Tabby" },
  { value: "tamara", label: "Tamara" },
  { value: "bank", label: "Bank installment plan" },
  { value: "supplier", label: "Supplier credit plan" },
  { value: "other", label: "Other" },
];

const FREQUENCIES: { value: InstallmentFrequency; label: string }[] = [
  { value: "monthly", label: "Monthly" },
  { value: "biweekly", label: "Every 2 weeks" },
  { value: "weekly", label: "Weekly" },
];

const today = () => format(new Date(), "yyyy-MM-dd");

export default function Installments() {
  const { branches, activeBranchId, pinnedBranchId } = useBranch();
  const scopedBranchId = pinnedBranchId ?? activeBranchId ?? null;
  const { restaurant } = useAuth();
  const { format: money } = useCurrency();
  const { accounts: coa } = useChartOfAccounts();
  const { summaries: capitalAccounts } = useOwnerCapital({ branchId: scopedBranchId });

  const [tab, setTab] = useState("plans");
  const { summaries, totals, isLoading, createPlan, payInstallment, voidPayment, reschedulePlan, updatePlanDetails } =
    useInstallmentPlans({ branchId: scopedBranchId });

  const branchName = (id: string | null | undefined) =>
    id ? branches.find((b) => b.id === id)?.name ?? "Unknown branch" : "All branches";

  /** Fixed assets + expense accounts are valid purchase targets. */
  const targetAccounts = useMemo(
    () =>
      (coa ?? []).filter(
        (a: any) =>
          a.is_active &&
          ((a.account_type === "asset" && String(a.account_code) >= "1500" && String(a.account_code) < "1600") ||
            a.account_type === "expense"),
      ),
    [coa],
  );

  const cashAccounts = useMemo(
    () =>
      (coa ?? []).filter(
        (a: any) => a.account_type === "asset" && a.is_active && String(a.account_code) < "1200",
      ),
    [coa],
  );

  const accountLabel = (id: string | null | undefined) => {
    const a = (coa ?? []).find((x: any) => x.id === id);
    return a ? `${a.account_code} - ${a.account_name}` : "-";
  };

  // ---- Dialog: new plan ----------------------------------------------
  const [planOpen, setPlanOpen] = useState(false);
  const [provider, setProvider] = useState<InstallmentProvider>("tabby");
  const [description, setDescription] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [targetAccount, setTargetAccount] = useState("");
  const [cashPrice, setCashPrice] = useState("");
  const [financeCharge, setFinanceCharge] = useState("0");
  const [count, setCount] = useState("4");
  const [frequency, setFrequency] = useState<InstallmentFrequency>("monthly");
  const [purchaseDate, setPurchaseDate] = useState(today());
  const [firstDue, setFirstDue] = useState(today());
  const [planBranch, setPlanBranch] = useState<string>("scoped");
  const [notes, setNotes] = useState("");
  const [invoiceUrl, setInvoiceUrl] = useState<string | null>(null);
  const [assetClassId, setAssetClassId] = useState<string>("none");
  const [assetTag, setAssetTag] = useState("");

  const planBranchId = planBranch === "scoped" ? scopedBranchId : planBranch;
  const { classes: assetClasses } = useFixedAssets({ branchId: planBranchId });
  const branchVat = useBranchVatRate(planBranchId);
  const [vatPercent, setVatPercent] = useState<string>("");
  const [priceIncludesVat, setPriceIncludesVat] = useState<boolean | null>(null);
  const [vatOnFinance, setVatOnFinance] = useState(false);

  // Default to the branch VAT settings until the user overrides them.
  const effectiveVatPercent =
    vatPercent === "" ? branchVat.vatPercent : Number(vatPercent) || 0;
  const effectiveIncludesVat =
    priceIncludesVat === null ? branchVat.pricesInclusive : priceIncludesVat;

  const split = splitInstallmentPurchase({
    price: Number(cashPrice) || 0,
    financeCharge: Number(financeCharge) || 0,
    vatPercent: effectiveVatPercent,
    priceIncludesVat: effectiveIncludesVat,
    vatOnFinanceCharge: vatOnFinance,
  });
  const previewTotal = split.totalPayable;
  const previewPer = Number(count) > 0 ? previewTotal / Number(count) : 0;

  const submitPlan = async () => {
    if (!description.trim() || !targetAccount || !(Number(cashPrice) > 0) || !(Number(count) > 0)) {
      toast.error("Description, account, cash price and number of installments are required");
      return;
    }
    try {
      await createPlan.mutateAsync({
        description: description.trim(),
        targetAccountId: targetAccount,
        cashPrice: Number(cashPrice),
        financeCharge: Number(financeCharge) || 0,
        installmentCount: Number(count),
        firstDueDate: firstDue,
        purchaseDate,
        provider,
        frequency,
        supplierName: supplierName.trim() || null,
        branchId: planBranchId,
        notes: notes.trim() || null,
        vatRate: effectiveVatPercent,
        priceIncludesVat: effectiveIncludesVat,
        vatOnFinanceCharge: vatOnFinance,
        invoiceUrl,
        assetClassId: assetClassId === "none" ? null : assetClassId,
        assetTag: assetTag.trim() || null,
      });
      toast.success(
        assetClassId === "none"
          ? "Installment purchase recorded — asset, recoverable VAT and finance charges split; cash untouched"
          : "Installment purchase recorded and added to the Fixed Asset Register — depreciation starts from the purchase date",
      );
      setPlanOpen(false);
      setDescription("");
      setSupplierName("");
      setCashPrice("");
      setFinanceCharge("0");
      setNotes("");
      setInvoiceUrl(null);
      setAssetClassId("none");
      setAssetTag("");
    } catch (e: any) {
      toast.error(e.message ?? "Could not record the installment purchase");
    }
  };

  // ---- Dialog: pay installment ---------------------------------------
  const [payOpen, setPayOpen] = useState(false);
  const [payTarget, setPayTarget] = useState<{ id: string; label: string; amount: number } | null>(null);
  const [payDate, setPayDate] = useState(today());
  const [funding, setFunding] = useState<"company" | "partner">("company");
  const [payAccount, setPayAccount] = useState("");
  const [capitalAccount, setCapitalAccount] = useState("");
  const [payRef, setPayRef] = useState("");

  const openPay = (plan: PlanSummary, installmentId: string) => {
    const row = plan.schedule.find((s) => s.id === installmentId);
    if (!row) return;
    setPayTarget({
      id: row.id,
      label: `${plan.description} — installment ${row.installment_no}/${plan.installment_count}`,
      amount: Number(row.amount),
    });
    setPayDate(today());
    setFunding("company");
    setPayAccount(cashAccounts[0]?.id ?? "");
    setCapitalAccount("");
    setPayRef("");
    setPayOpen(true);
  };

  const submitPay = async () => {
    if (!payTarget) return;
    if (funding === "company" && !payAccount) {
      toast.error("Select the cash or bank account that funded this installment");
      return;
    }
    if (funding === "partner" && !capitalAccount) {
      toast.error("Select the partner capital account that funded this installment");
      return;
    }
    try {
      await payInstallment.mutateAsync({
        installmentId: payTarget.id,
        paidDate: payDate,
        fundingSource: funding,
        paymentAccountId: funding === "company" ? payAccount : null,
        capitalAccountId: funding === "partner" ? capitalAccount : null,
        referenceNumber: payRef.trim() || null,
      });
      toast.success("Installment settled — BNPL payable reduced");
      setPayOpen(false);
    } catch (e: any) {
      toast.error(e.message ?? "Could not settle the installment");
    }
  };

  const handleVoid = async (installmentId: string) => {
    const reason = window.prompt("Reason for reversing this installment payment?");
    if (reason === null) return;
    try {
      await voidPayment.mutateAsync({ installmentId, reason: reason.trim() || null });
      toast.success("Payment reversed — a reversal journal entry was posted");
    } catch (e: any) {
      toast.error(e.message ?? "Could not reverse the payment");
    }
  };

  // ---- Dialog: edit schedule (fix a mistyped installment count) -------
  const [editPlan, setEditPlan] = useState<PlanSummary | null>(null);
  const [editCount, setEditCount] = useState("");
  const [editFinanceCharge, setEditFinanceCharge] = useState("0");
  const [editFirstDue, setEditFirstDue] = useState(today());
  const [editFrequency, setEditFrequency] = useState<InstallmentFrequency>("monthly");

  const openEdit = (p: PlanSummary) => {
    setEditPlan(p);
    setEditCount(String(p.installment_count));
    setEditFinanceCharge(String(Number(p.finance_charge || 0)));
    setEditFirstDue(p.first_due_date);
    setEditFrequency(p.frequency);
  };

  const { summaries: editAssets } = useFixedAssets({ branchId: editPlan?.branch_id ?? null });
  const editLinkedAsset = editPlan?.asset_id
    ? editAssets.find((a) => a.id === editPlan.asset_id) ?? null
    : null;

  const { totals: editLedgerTotals } = useInstallmentLedgerTotals(editPlan);
  const editIntegrity = editPlan
    ? checkInstallmentIntegrity({
        cashPrice: Number(editPlan.cash_price || 0),
        currentFinanceCharge: Number(editPlan.finance_charge || 0),
        currentTotalPayable: Number(editPlan.total_payable || 0),
        vatAmount:
          Number(editPlan.total_payable || 0) -
          Number(editPlan.cash_price || 0) -
          Number(editPlan.finance_charge || 0),
        paidAmount: Number(editPlan.paidAmount || 0),
        paidCount: editPlan.paidCount,
        nextFinanceCharge: Number(editFinanceCharge),
        nextInstallmentCount: Number(editCount),
        ledger: editLedgerTotals,
        assetCost: editLinkedAsset ? Number(editLinkedAsset.cost ?? 0) : null,
        assetName: editLinkedAsset?.name ?? null,
      })
    : null;

  const submitEdit = async () => {
    if (!editPlan) return;
    const n = Number(editCount);
    const revisedFinanceCharge = Number(editFinanceCharge);
    const failed = editIntegrity?.checks.find((c) => c.status === "error");
    if (failed) {
      toast.error(`${failed.label}: ${failed.detail}`);
      return;
    }
    try {
      await reschedulePlan.mutateAsync({
        planId: editPlan.id,
        installmentCount: n,
        firstDueDate: editFirstDue,
        frequency: editFrequency,
        financeCharge: revisedFinanceCharge,
      });
      toast.success("Finance charge and schedule updated");
      setEditPlan(null);
    } catch (e: any) {
      toast.error(e.message ?? "Could not update the schedule");
    }
  };

  // ---- Dialog: edit attachment + asset class --------------------------
  const [detailsPlan, setDetailsPlan] = useState<PlanSummary | null>(null);
  const [auditPlan, setAuditPlan] = useState<PlanSummary | null>(null);
  const [detailsInvoice, setDetailsInvoice] = useState<string | null>(null);
  const [detailsClass, setDetailsClass] = useState<string>("none");
  const [detailsTag, setDetailsTag] = useState("");
  const { classes: detailsClasses, assets: detailsAssets } = useFixedAssets({
    branchId: detailsPlan?.branch_id ?? null,
  });

  const openDetails = (p: PlanSummary) => {
    setDetailsPlan(p);
    setDetailsInvoice(p.invoice_url ?? null);
    setDetailsClass(p.asset_class_id ?? "none");
    setDetailsTag("");
  };

  const submitDetails = async () => {
    if (!detailsPlan) return;
    try {
      await updatePlanDetails.mutateAsync({
        planId: detailsPlan.id,
        invoiceUrl: detailsInvoice,
        clearInvoice: !detailsInvoice && !!detailsPlan.invoice_url,
        assetClassId: detailsClass === "none" ? null : detailsClass,
        assetTag: detailsTag.trim() || null,
      });
      toast.success("Installment purchase updated");
      setDetailsPlan(null);
    } catch (e: any) {
      toast.error(e.message ?? "Could not update the installment purchase");
    }
  };

  // ---- Upcoming schedule (flat) --------------------------------------
  const upcoming = useMemo(() => {
    const rows = summaries.flatMap((p) =>
      p.schedule
        .filter((s) => s.status !== "paid")
        .map((s) => ({ plan: p, row: s })),
    );
    return rows.sort((a, b) => a.row.due_date.localeCompare(b.row.due_date));
  }, [summaries]);

  const exportSchedule = () => {
    exportToCSV({
      headers: [
        "Plan", "Provider", "Branch", "Installment", "Due date", "Amount",
        "Status", "Paid date", "Funded by", "Reference",
      ],
      rows: summaries.flatMap((p) =>
        p.schedule.map((s) => [
          p.description,
          p.provider,
          branchName(p.branch_id),
          `${s.installment_no}/${p.installment_count}`,
          s.due_date,
          Number(s.amount).toFixed(2),
          s.status,
          s.paid_date ?? "",
          s.funding_source === "partner" ? "Partner capital" : accountLabel(s.payment_account_id),
          s.reference_number ?? "",
        ]),
      ),
      filename: `installments-${today()}.csv`,
    });
  };

  return (
    <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3 min-h-[56px]">
          <div className="min-w-[240px] flex-1"><h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight">Installment Purchases (BNPL)</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Equipment bought on Tabby, Tamara or bank plans — booked as an asset with a payable, never as cash.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <BranchScopeSelector hint="Plans and installments follow this branch" />
          <Button variant="outline" onClick={exportSchedule} disabled={summaries.length === 0}>
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
          <Button onClick={() => setPlanOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            New installment purchase
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Total financed</CardDescription>
            <CardTitle className="text-base font-medium">{money(totals.financed)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Paid to date</CardDescription>
            <CardTitle className="text-base font-medium">{money(totals.paid)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Outstanding (2450)</CardDescription>
            <CardTitle className="text-base font-medium">{money(totals.outstanding)}</CardTitle>
          </CardHeader>
        </Card>
        <Card className={totals.overdue > 0 ? "border-destructive/50" : undefined}>
          <CardHeader className="pb-3">
            <CardDescription className="flex items-center gap-1">
              {totals.overdue > 0 && <AlertTriangle className="h-3.5 w-3.5 text-destructive" />}
              Overdue
            </CardDescription>
            <CardTitle className="text-base font-medium">{money(totals.overdue)}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="plans">Plans</TabsTrigger>
          <TabsTrigger value="upcoming">Upcoming installments</TabsTrigger>
          <TabsTrigger value="how">How it posts</TabsTrigger>
        </TabsList>

        <TabsContent value="plans" className="space-y-4">
          {isLoading && <p className="text-sm text-muted-foreground">Loading plans…</p>}
          {!isLoading && summaries.length === 0 && (
            <Card>
              <CardContent className="pt-6 text-center text-sm text-muted-foreground">
                No installment purchases recorded yet.
              </CardContent>
            </Card>
          )}
          {summaries.map((p) => (
            <Card key={p.id}>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-base font-medium flex items-center gap-2">
                      {p.description}
                      <Badge variant="outline" className="capitalize">{p.provider}</Badge>
                      <Badge variant={p.status === "completed" ? "secondary" : "default"} className="capitalize">
                        {p.status}
                      </Badge>
                      {p.overdueCount > 0 && (
                        <Badge variant="destructive">{p.overdueCount} overdue</Badge>
                      )}
                    </CardTitle>
                    <CardDescription>
                      {branchName(p.branch_id)} · purchased {p.purchase_date} · {accountLabel(p.target_account_id)}
                      {p.supplier_name ? ` · ${p.supplier_name}` : ""}
                    </CardDescription>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      {p.asset_id && (
                        <Badge variant="secondary" className="gap-1">
                          <Landmark className="h-3 w-3" />
                          In fixed asset register
                        </Badge>
                      )}
                      {p.invoice_url && (
                        <InvoiceActions path={p.invoice_url} fileName={`invoice-${p.description}`} />
                      )}
                    </div>
                  </div>
                  <div className="text-right text-sm">
                    <div className="text-muted-foreground">Outstanding</div>
                    <div className="text-lg font-light">{money(p.outstanding)}</div>
                    <div className="text-xs text-muted-foreground">
                      {p.paidCount}/{p.installment_count} paid · total {money(p.total_payable)}
                      {Number(p.finance_charge) > 0 && ` · finance ${money(p.finance_charge)}`}
                    </div>
                    <Button size="sm" variant="ghost" className="mt-1" onClick={() => openEdit(p)}>
                      <Pencil className="h-3.5 w-3.5 mr-1" />
                      Edit schedule
                    </Button>
                    <Button size="sm" variant="ghost" className="mt-1" onClick={() => openDetails(p)}>
                      <Paperclip className="h-3.5 w-3.5 mr-1" />
                      Invoice &amp; asset
                    </Button>
                    <Button size="sm" variant="ghost" className="mt-1" onClick={() => setAuditPlan(p)}>
                      <History className="h-3.5 w-3.5 mr-1" />
                      Audit trail
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <ScrollArea className="max-h-[520px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>#</TableHead>
                        <TableHead>Due</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Funded by</TableHead>
                        <TableHead className="text-right">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {p.schedule.map((s) => {
                        const overdue = s.status !== "paid" && s.due_date < today();
                        return (
                          <TableRow key={s.id}>
                            <TableCell>{s.installment_no}</TableCell>
                            <TableCell className={overdue ? "text-destructive" : undefined}>
                              {s.due_date}
                            </TableCell>
                            <TableCell className="text-right">{money(Number(s.amount))}</TableCell>
                            <TableCell>
                              <Badge variant={s.status === "paid" ? "secondary" : overdue ? "destructive" : "outline"}>
                                {s.status === "paid" ? `Paid ${s.paid_date}` : overdue ? "Overdue" : "Pending"}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {s.status === "paid"
                                ? s.funding_source === "partner"
                                  ? "Partner capital"
                                  : accountLabel(s.payment_account_id)
                                : "-"}
                            </TableCell>
                            <TableCell className="text-right">
                              {s.status === "paid" ? (
                                <Button size="sm" variant="ghost" onClick={() => handleVoid(s.id)}>
                                  <RotateCcw className="h-3.5 w-3.5 mr-1" />
                                  Reverse
                                </Button>
                              ) : (
                                <Button size="sm" variant="outline" onClick={() => openPay(p, s.id)}>
                                  <Banknote className="h-3.5 w-3.5 mr-1" />
                                  Pay
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="upcoming">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium flex items-center gap-2">
                <CalendarClock className="h-4 w-4" />
                Upcoming and overdue installments
              </CardTitle>
              <CardDescription>Ordered by due date across all active plans.</CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="max-h-[520px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Due</TableHead>
                      <TableHead>Plan</TableHead>
                      <TableHead>Branch</TableHead>
                      <TableHead>#</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {upcoming.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">
                          Nothing outstanding.
                        </TableCell>
                      </TableRow>
                    )}
                    {upcoming.map(({ plan, row }) => (
                      <TableRow key={row.id}>
                        <TableCell className={row.due_date < today() ? "text-destructive" : undefined}>
                          {row.due_date}
                        </TableCell>
                        <TableCell>{plan.description}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {branchName(plan.branch_id)}
                        </TableCell>
                        <TableCell>
                          {row.installment_no}/{plan.installment_count}
                        </TableCell>
                        <TableCell className="text-right">{money(Number(row.amount))}</TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" variant="outline" onClick={() => openPay(plan, row.id)}>
                            Pay
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="how">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium">How these entries hit the ledger</CardTitle>
              <CardDescription>Accounting treatment applied automatically.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div>
                <div className="font-medium">1. At purchase (no cash moves)</div>
                <p className="text-muted-foreground">
                  DR the fixed asset or expense account for the cash price · DR 6850 Finance &amp; Installment
                  Charges for any provider markup · CR 2450 BNPL / Installment Payable for the total payable.
                </p>
              </div>
              <div>
                <div className="font-medium">2. On each installment</div>
                <p className="text-muted-foreground">
                  DR 2450 BNPL / Installment Payable · CR the cash or bank account that actually funded it.
                  Cash in hand and cash in bank only move when an installment clears.
                </p>
              </div>
              <div>
                <div className="font-medium">3. If a partner pays personally</div>
                <p className="text-muted-foreground">
                  DR 2450 · CR the partner&apos;s equity capital account (3401–3499). Company cash is untouched and
                  the partner&apos;s capital balance increases.
                </p>
              </div>
              <div>
                <div className="font-medium">4. Depreciation</div>
                <p className="text-muted-foreground">
                  Equipment booked here depreciates over its useful life (DR 6700 Depreciation · CR 1600
                  Accumulated Depreciation), so a single purchase never spikes one day&apos;s P&amp;L.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* New plan dialog */}
      <Dialog open={planOpen} onOpenChange={setPlanOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>New installment purchase</DialogTitle>
            <DialogDescription>
              Books the asset and opens a BNPL payable. No cash or bank account is touched until you settle an
              installment.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[65vh] pr-3">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2 space-y-2">
                <Label>What was purchased</Label>
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="e.g. Combi oven and prep counter"
                />
              </div>
              <div className="space-y-2">
                <Label>Provider</Label>
                <Select value={provider} onValueChange={(v) => setProvider(v as InstallmentProvider)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PROVIDERS.map((p) => (
                      <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {(() => {
                  const acc = (coa ?? []).find((a: any) => a.id === payAccount);
                  const code = String(acc?.account_code ?? "");
                  const isDrawer = code >= "1000" && code < "1010";
                  if (!acc) return null;
                  return (
                    <p className="text-xs text-muted-foreground">
                      {isDrawer
                        ? "Paid from the till: this amount is deducted from the open shift's expected cash and appears in the shift closure breakdown."
                        : "Paid from the bank: the drawer and shift closure totals are not affected."}
                    </p>
                  );
                })()}
              </div>
              <div className="space-y-2">
                <Label>Supplier / merchant (optional)</Label>
                <Input value={supplierName} onChange={(e) => setSupplierName(e.target.value)} />
              </div>
              <div className="sm:col-span-2 space-y-2">
                <Label>Book to account</Label>
                <Select value={targetAccount} onValueChange={setTargetAccount}>
                  <SelectTrigger><SelectValue placeholder="Select a fixed asset or expense account" /></SelectTrigger>
                  <SelectContent>
                    {targetAccounts.map((a: any) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.account_code} - {a.account_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Equipment belongs in 1500–1599 fixed assets so it depreciates instead of spiking one day&apos;s P&amp;L.
                </p>
              </div>
              <div className="space-y-2">
                <Label>Cash price {effectiveIncludesVat ? "(VAT inclusive)" : "(excl. VAT)"}</Label>
                <Input type="number" value={cashPrice} onChange={(e) => setCashPrice(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Finance charge / markup</Label>
                <Input type="number" value={financeCharge} onChange={(e) => setFinanceCharge(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>VAT rate (%)</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  value={vatPercent === "" ? String(branchVat.vatPercent) : vatPercent}
                  onChange={(e) => setVatPercent(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Defaults to this branch&apos;s VAT rate. VAT posts to 1180 Input VAT Recoverable.
                </p>
              </div>
              <div className="space-y-3 rounded-md border p-3">
                <div className="flex items-center justify-between gap-3">
                  <Label className="text-sm font-normal">Price already includes VAT</Label>
                  <Switch
                    checked={effectiveIncludesVat}
                    onCheckedChange={(v) => setPriceIncludesVat(v)}
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <Label className="text-sm font-normal">VAT on finance charge</Label>
                  <Switch checked={vatOnFinance} onCheckedChange={setVatOnFinance} />
                </div>
                <p className="text-xs text-muted-foreground">
                  BNPL finance charges are normally VAT exempt — only enable if the provider invoices VAT on the fee.
                </p>
              </div>
              <div className="space-y-2">
                <Label>Number of installments</Label>
                <Input type="number" min={1} value={count} onChange={(e) => setCount(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Frequency</Label>
                <Select value={frequency} onValueChange={(v) => setFrequency(v as InstallmentFrequency)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FREQUENCIES.map((f) => (
                      <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Purchase date</Label>
                <Input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>First installment due</Label>
                <Input type="date" value={firstDue} onChange={(e) => setFirstDue(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Branch</Label>
                <Select value={planBranch} onValueChange={setPlanBranch}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="scoped">{branchName(scopedBranchId)}</SelectItem>
                    {branches.map((b) => (
                      <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="sm:col-span-2 space-y-2">
                <Label>Notes</Label>
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
              </div>
              <div className="space-y-2">
                <Label>Fixed asset class</Label>
                <Select value={assetClassId} onValueChange={setAssetClassId}>
                  <SelectTrigger><SelectValue placeholder="Do not capitalise" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Do not add to asset register</SelectItem>
                    {assetClasses.map((c: any) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                        {c.useful_life_months ? ` · ${Math.round(c.useful_life_months / 12)}y` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Registers the equipment in the Fixed Asset Register and starts monthly depreciation.
                </p>
              </div>
              <div className="space-y-2">
                <Label>Asset tag (optional)</Label>
                <Input
                  value={assetTag}
                  onChange={(e) => setAssetTag(e.target.value)}
                  placeholder="e.g. KIT-OVEN-01"
                  disabled={assetClassId === "none"}
                />
              </div>
              {assetClassId !== "none" && (
                <div className="sm:col-span-2 space-y-2">
                  <Label>Depreciation schedule preview</Label>
                  {(() => {
                    const cls: any = assetClasses.find((c: any) => c.id === assetClassId);
                    if (!cls) return null;
                    return (
                      <DepreciationSchedulePreview
                        cost={Number(cashPrice) || 0}
                        startDate={purchaseDate}
                        usefulLifeMonths={cls.useful_life_months}
                        depreciationMethod={cls.depreciation_method}
                        salvageRatePct={cls.salvage_rate_pct}
                      />
                    );
                  })()}
                </div>
              )}
              {restaurant?.id && (
                <div className="sm:col-span-2 space-y-2">
                  <Label>Invoice / receipt</Label>
                  <InvoiceImageUploader
                    imageUrl={invoiceUrl}
                    onImageChange={setInvoiceUrl}
                    restaurantId={restaurant.id}
                  />
                </div>
              )}
              <div className="sm:col-span-2 rounded-md border p-3 text-sm">
                <div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
                  Ledger split on posting
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">DR asset / expense (net)</span>
                  <span>{money(split.netAsset)}</span>
                </div>
                {split.recoverableVat > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">
                      DR 1180 Input VAT recoverable ({effectiveVatPercent}%)
                    </span>
                    <span>{money(split.recoverableVat)}</span>
                  </div>
                )}
                {split.financeNet > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">DR 6850 Finance charges</span>
                    <span>{money(split.financeNet)}</span>
                  </div>
                )}
                <div className="flex items-center justify-between border-t mt-2 pt-2">
                  <span className="text-muted-foreground">CR 2450 BNPL payable</span>
                  <span>{money(split.totalPayable)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Total payable</span>
                  <span>{money(previewTotal)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Per installment (approx.)</span>
                  <span>{money(previewPer)}</span>
                </div>
              </div>
            </div>
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPlanOpen(false)}>Cancel</Button>
            <Button onClick={submitPlan} disabled={createPlan.isPending}>
              {createPlan.isPending ? "Recording…" : "Record purchase"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pay installment dialog */}
      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Settle installment</DialogTitle>
            <DialogDescription>{payTarget?.label}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-md border p-3 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Amount</span>
              <span className="text-lg font-light">{money(payTarget?.amount ?? 0)}</span>
            </div>
            <div className="space-y-2">
              <Label>Payment date</Label>
              <Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Funded by</Label>
              <Select value={funding} onValueChange={(v) => setFunding(v as "company" | "partner")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="company">Company cash / bank</SelectItem>
                  <SelectItem value="partner">Partner capital account</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {funding === "company" ? (
              <div className="space-y-2">
                <Label>Cash / bank account</Label>
                <Select value={payAccount} onValueChange={setPayAccount}>
                  <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
                  <SelectContent>
                    {cashAccounts.map((a: any) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.account_code} - {a.account_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-2">
                <Label className="flex items-center gap-1">
                  <Wallet className="h-3.5 w-3.5" /> Partner capital account
                </Label>
                <Select value={capitalAccount} onValueChange={setCapitalAccount}>
                  <SelectTrigger><SelectValue placeholder="Select partner" /></SelectTrigger>
                  <SelectContent>
                    {capitalAccounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.partner_name} - {a.bank_name} ..{a.account_last4}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2">
              <Label>Reference (optional)</Label>
              <Input value={payRef} onChange={(e) => setPayRef(e.target.value)} placeholder="Bank/transfer reference" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(false)}>Cancel</Button>
            <Button onClick={submitPay} disabled={payInstallment.isPending}>
              {payInstallment.isPending ? "Posting…" : "Post settlement"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit schedule dialog */}
      <Dialog open={!!editPlan} onOpenChange={(o) => !o && setEditPlan(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit installment schedule</DialogTitle>
            <DialogDescription>
              {editPlan?.description} — paid installments stay untouched. The revised total is posted to the
              ledger and the remaining balance is spread evenly across the schedule.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Number of installments</Label>
              <Input
                type="number"
                min={(editPlan?.paidCount ?? 0) + 1}
                value={editCount}
                onChange={(e) => setEditCount(e.target.value)}
              />
              {editPlan && Number(editCount) > editPlan.paidCount && (
                <p className="text-xs text-muted-foreground">
                  {Number(editCount) - editPlan.paidCount} remaining payment(s) of about{" "}
                  {money(editPlan.outstanding / Math.max(1, Number(editCount) - editPlan.paidCount))} each.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Finance charge</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={editFinanceCharge}
                onChange={(e) => setEditFinanceCharge(e.target.value)}
              />
            </div>
            {editPlan && (
              <FinanceChargeComparison
                currentFinanceCharge={Number(editPlan.finance_charge || 0)}
                currentTotalPayable={Number(editPlan.total_payable || 0)}
                currentInstallmentCount={Number(editPlan.installment_count || 0)}
                nextFinanceCharge={Number(editFinanceCharge)}
                nextInstallmentCount={Number(editCount)}
                cashPrice={Number(editPlan.cash_price || 0)}
                paidAmount={Number(editPlan.paidAmount || 0)}
                paidCount={editPlan.paidCount}
                money={money}
                asset={
                  editLinkedAsset
                    ? {
                        name: editLinkedAsset.name,
                        netBookValue: editLinkedAsset.netBookValue,
                        monthlyDepreciation: editLinkedAsset.monthlyDepreciation,
                        monthsRemaining: editLinkedAsset.monthsRemaining,
                      }
                    : null
                }
              />
            )}
            {editIntegrity && <InstallmentIntegrityChecklist result={editIntegrity} />}
            <div className="space-y-2">
              <Label>First due date</Label>
              <Input type="date" value={editFirstDue} onChange={(e) => setEditFirstDue(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Frequency</Label>
              <Select value={editFrequency} onValueChange={(v) => setEditFrequency(v as InstallmentFrequency)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FREQUENCIES.map((f) => (
                    <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditPlan(null)}>Cancel</Button>
            <Button
              onClick={submitEdit}
              disabled={reschedulePlan.isPending || !!editIntegrity?.hasErrors}
            >
              {reschedulePlan.isPending ? "Updating…" : "Update schedule"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Invoice & fixed asset dialog */}
      <Dialog open={!!detailsPlan} onOpenChange={(o) => !o && setDetailsPlan(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invoice &amp; fixed asset</DialogTitle>
            <DialogDescription>
              {detailsPlan?.description} — update the attached invoice or the fixed asset class. The asset class
              can only be changed while no depreciation has been posted.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[70vh]">
            <div className="space-y-4 pr-2">
              <div className="space-y-2">
                <Label>Fixed asset class</Label>
                <Select value={detailsClass} onValueChange={setDetailsClass}>
                  <SelectTrigger><SelectValue placeholder="Do not capitalise" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Do not add to asset register</SelectItem>
                    {detailsClasses.map((c: any) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                        {c.useful_life_months ? ` · ${Math.round(c.useful_life_months / 12)}y` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Selecting a class registers (or reclassifies) the equipment in the Fixed Asset Register.
                  Clearing it removes the asset record.
                </p>
              </div>
              <div className="space-y-2">
                <Label>Asset tag (optional)</Label>
                <Input
                  value={detailsTag}
                  onChange={(e) => setDetailsTag(e.target.value)}
                  placeholder="e.g. KIT-OVEN-01"
                  disabled={detailsClass === "none"}
                />
              </div>
              {detailsClass !== "none" && detailsPlan && (
                <div className="space-y-2">
                  <Label>Depreciation schedule preview</Label>
                  {(() => {
                    const cls: any = detailsClasses.find((c: any) => c.id === detailsClass);
                    if (!cls) return null;
                    const asset: any = (detailsAssets as any[]).find((a) => a.id === detailsPlan.asset_id);
                    return (
                      <DepreciationSchedulePreview
                        cost={Number(asset?.cost ?? detailsPlan.cash_price) || 0}
                        startDate={asset?.in_service_date ?? detailsPlan.purchase_date}
                        usefulLifeMonths={asset?.useful_life_months ?? cls.useful_life_months}
                        depreciationMethod={cls.depreciation_method}
                        salvageRatePct={cls.salvage_rate_pct}
                        accumulatedPosted={Number(asset?.accumulated_depreciation ?? 0)}
                      />
                    );
                  })()}
                </div>
              )}
              {restaurant?.id && (
                <div className="space-y-2">
                  <Label>Invoice / receipt</Label>
                  <InvoiceImageUploader
                    imageUrl={detailsInvoice}
                    onImageChange={setDetailsInvoice}
                    restaurantId={restaurant.id}
                  />
                </div>
              )}
            </div>
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailsPlan(null)}>Cancel</Button>
            <Button onClick={submitDetails} disabled={updatePlanDetails.isPending}>
              {updatePlanDetails.isPending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <InstallmentAuditTrailDialog
        planId={auditPlan?.id ?? null}
        title={auditPlan?.description}
        open={!!auditPlan}
        onOpenChange={(o) => !o && setAuditPlan(null)}
      />
    </div>
  );
}