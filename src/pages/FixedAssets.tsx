import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { format, startOfMonth, subMonths } from "date-fns";
import {
  AlertTriangle,
  Building2,
  CalendarClock,
  Download,
  Landmark,
  Plus,
  Settings2,
  TrendingDown,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { BranchScopeSelector } from "@/components/branches/BranchScopeSelector";
import { useBranch } from "@/contexts/BranchContext";
import { useCurrency } from "@/hooks/useCurrency";
import { useChartOfAccounts } from "@/hooks/useChartOfAccounts";
import { useOwnerCapital } from "@/hooks/useOwnerCapital";
import { useFixedAssets } from "@/hooks/useFixedAssets";
import type { DisposalType, SettlementMethod } from "@/hooks/useFixedAssets";
import { useProjects } from "@/hooks/useProjects";
import { exportToCSV } from "@/lib/exportUtils";
import { toast } from "sonner";
import { usePermissions } from "@/contexts/PermissionsContext";
import { AssetClassTemplates } from "@/components/accounting/AssetClassTemplates";
import { InvoiceActions } from "@/components/accounting/InvoiceActions";
import {
  clearCapexHandoff,
  readCapexHandoff,
  resolveCapexHandoff,
  type CapexHandoff,
} from "@/lib/capexHandoff";
import { supabase } from "@/integrations/supabase/client";

export default function FixedAssets() {
  const navigate = useNavigate();
  const { branches, activeBranchId, pinnedBranchId } = useBranch();
  const scopedBranchId = pinnedBranchId ?? activeBranchId ?? null;
  const { isOwner, isManager, isAccountant } = usePermissions();
  const canManageClasses = isOwner || isManager || isAccountant;
  const { format: money } = useCurrency();
  const { accounts: coa } = useChartOfAccounts();
  const { summaries: capitalAccounts } = useOwnerCapital({ branchId: scopedBranchId });

  /** Invoices attached to installment purchases, keyed by the asset they created. */
  const { data: assetInvoices = {} } = useQuery({
    queryKey: ["installment-asset-invoices"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("installment_plans")
        .select("asset_id, invoice_url, description")
        .not("asset_id", "is", null)
        .not("invoice_url", "is", null);
      if (error) throw error;
      const map: Record<string, { url: string; description: string }> = {};
      (data ?? []).forEach((r: any) => {
        map[r.asset_id] = { url: r.invoice_url, description: r.description };
      });
      return map;
    },
    staleTime: 120_000,
  });

  const {
    settings,
    threshold,
    classes,
    allClasses,
    summaries,
    depreciation,
    runs,
    disposals,
    totals,
    isLoading,
    needsSetup,
    bootstrap,
    saveSettings,
    saveClass,
    copyClassesToBranch,
    deleteBranchClass,
    recordPurchase,
    postDepreciation,
    disposeAsset,
    settleDisposal,
  } = useFixedAssets({ branchId: scopedBranchId });

  const [tab, setTab] = useState("register");

  const branchName = (id: string | null | undefined) =>
    id ? branches.find((b) => b.id === id)?.name ?? "Unknown branch" : "All branches";

  const cashAccounts = useMemo(
    () =>
      (coa ?? []).filter(
        (a: any) => a.account_type === "asset" && a.is_active && String(a.account_code) < "1100",
      ),
    [coa],
  );
  const expenseAccounts = useMemo(
    () => (coa ?? []).filter((a: any) => a.account_type === "expense" && a.is_active),
    [coa],
  );

  // ---- Settings -------------------------------------------------------
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [thresholdInput, setThresholdInput] = useState("");
  const [autoExpense, setAutoExpense] = useState(true);
  const [defaultLife, setDefaultLife] = useState("60");
  const [defaultExpenseAccount, setDefaultExpenseAccount] = useState("");
  const [autoPost, setAutoPost] = useState(true);
  const [autoPostDay, setAutoPostDay] = useState("1");

  const openSettings = () => {
    setThresholdInput(String(settings?.capitalization_threshold ?? 1500));
    setAutoExpense(settings?.auto_expense_below_threshold ?? true);
    setDefaultLife(String(settings?.default_useful_life_months ?? 60));
    setDefaultExpenseAccount(settings?.default_expense_account_id ?? "");
    setAutoPost(settings?.auto_post_enabled ?? true);
    setAutoPostDay(String(settings?.auto_post_day ?? 1));
    setSettingsOpen(true);
  };

  const submitSettings = async () => {
    const value = Number(thresholdInput);
    if (!(value >= 0)) {
      toast.error("Enter a valid capitalization threshold");
      return;
    }
    try {
      const day = Math.min(Math.max(Number(autoPostDay) || 1, 1), 28);
      await saveSettings.mutateAsync({
        capitalizationThreshold: value,
        autoExpenseBelowThreshold: autoExpense,
        defaultUsefulLifeMonths: Number(defaultLife) || 60,
        defaultExpenseAccountId: defaultExpenseAccount || null,
        autoPostEnabled: autoPost,
        autoPostDay: day,
      });
      toast.success("Capitalization policy saved");
      setSettingsOpen(false);
    } catch (e: any) {
      toast.error(e.message ?? "Could not save the policy");
    }
  };

  // ---- Record purchase -------------------------------------------------
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [name, setName] = useState("");
  const [cost, setCost] = useState("");
  const [classId, setClassId] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [supplier, setSupplier] = useState("");
  const [funding, setFunding] = useState<"company" | "partner" | "credit">("company");
  const [paymentAccount, setPaymentAccount] = useState("");
  const [capitalAccount, setCapitalAccount] = useState("");
  const [expenseAccount, setExpenseAccount] = useState("");
  const [life, setLife] = useState("");
  const [salvage, setSalvage] = useState("0");
  const [vatRate, setVatRate] = useState("15");
  const [vatIncluded, setVatIncluded] = useState(true);
  const [assetTag, setAssetTag] = useState("");
  const [purchaseNotes, setPurchaseNotes] = useState("");
  const [override, setOverride] = useState<"auto" | "capitalize" | "expense">("auto");
  const [projectId, setProjectId] = useState("none");
  const { projects: projectList } = useProjects();

  // ---- Hand-off from a blocked expense ---------------------------------
  const [capexHandoff, setCapexHandoff] = useState<CapexHandoff | null>(null);

  useEffect(() => {
    const handoff = readCapexHandoff();
    if (!handoff) return;
    setCapexHandoff(handoff);
    if (handoff.status !== "pending") return;
    const d = handoff.draft ?? {};
    if (d.description) setName(d.description);
    if (d.amount) setCost(d.amount);
    if (d.expenseDate) setPurchaseDate(d.expenseDate);
    if (d.supplierName) setSupplier(d.supplierName);
    if (d.vatRatePercent) {
      setVatRate(d.vatRatePercent);
      setVatIncluded(d.vatInclusive ?? true);
    }
    if (handoff.link?.projectId) setProjectId(handoff.link.projectId);
    setPurchaseOpen(true);
  }, []);

  const returnToExpense = () => {
    const path = capexHandoff?.returnPath || "/expenses";
    navigate(path);
  };

  const grossCost = Number(cost) || 0;
  const rate = (Number(vatRate) || 0) / 100;
  const netCost = useMemo(() => {
    if (!grossCost) return 0;
    if (rate > 0 && vatIncluded) return Math.round((grossCost / (1 + rate)) * 100) / 100;
    return Math.round(grossCost * 100) / 100;
  }, [grossCost, rate, vatIncluded]);
  const vatAmount = useMemo(() => {
    if (!grossCost || rate <= 0) return 0;
    return vatIncluded
      ? Math.round((grossCost - netCost) * 100) / 100
      : Math.round(grossCost * rate * 100) / 100;
  }, [grossCost, rate, vatIncluded, netCost]);

  const willCapitalize = useMemo(() => {
    if (override === "capitalize") return true;
    if (override === "expense") return false;
    if (settings && !settings.auto_expense_below_threshold) return true;
    return netCost >= threshold;
  }, [override, settings, netCost, threshold]);

  const selectedClass = classes.find((c) => c.id === classId) ?? classes[0];
  const effectiveLife =
    Number(life) || selectedClass?.useful_life_months || settings?.default_useful_life_months || 60;

  const resetPurchase = () => {
    setName("");
    setCost("");
    setSupplier("");
    setAssetTag("");
    setPurchaseNotes("");
    setLife("");
    setSalvage("0");
    setOverride("auto");
  };

  const submitPurchase = async () => {
    if (!name.trim() || !(grossCost > 0)) {
      toast.error("Enter the item name and its purchase cost");
      return;
    }
    if (funding === "partner" && !capitalAccount) {
      toast.error("Choose the partner account funding this purchase");
      return;
    }
    try {
      const result = await recordPurchase.mutateAsync({
        name: name.trim(),
        cost: grossCost,
        classId: classId || null,
        branchId: scopedBranchId,
        purchaseDate,
        supplierName: supplier.trim() || null,
        fundingSource: funding,
        paymentAccountId: funding === "company" ? paymentAccount || null : null,
        capitalAccountId: funding === "partner" ? capitalAccount : null,
        expenseAccountId: expenseAccount || null,
        usefulLifeMonths: Number(life) || null,
        salvageValue: Number(salvage) || 0,
        vatRate: Number(vatRate) || 0,
        priceIncludesVat: vatIncluded,
        assetTag: assetTag.trim() || null,
        notes: purchaseNotes.trim() || null,
        forceCapitalize: override === "capitalize",
        forceExpense: override === "expense",
        projectId: projectId !== "none" ? projectId : null,
      });
      toast.success(
        result.decision === "capitalized"
          ? `Capitalized as a fixed asset (${money(Number(result.net_amount))})`
          : `Below threshold — booked straight to expense (${money(Number(result.net_amount))})`,
      );
      if (capexHandoff?.status === "pending") {
        const resolved = resolveCapexHandoff({
          kind: result.decision === "capitalized" ? "capitalized" : "expensed",
          assetId: result.asset_id,
          assetName: name.trim(),
          amount: Number(result.net_amount),
        });
        setCapexHandoff(resolved);
      }
      setPurchaseOpen(false);
      resetPurchase();
    } catch (e: any) {
      toast.error(e.message ?? "Could not record the purchase");
    }
  };

  // ---- Depreciation ----------------------------------------------------
  const [depMonth, setDepMonth] = useState(format(startOfMonth(subMonths(new Date(), 1)), "yyyy-MM"));

  const runDepreciation = async () => {
    try {
      const result = await postDepreciation.mutateAsync({
        periodMonth: `${depMonth}-01`,
        branchId: scopedBranchId,
      });
      if (!result.assets) {
        toast.info("Nothing to depreciate for that month — it may already be posted");
      } else {
        toast.success(`Posted depreciation for ${result.assets} asset(s): ${money(Number(result.amount))}`);
      }
    } catch (e: any) {
      toast.error(e.message ?? "Could not post depreciation");
    }
  };

  // ---- Disposal --------------------------------------------------------
  const [disposeId, setDisposeId] = useState<string | null>(null);
  const [disposalDate, setDisposalDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [disposalType, setDisposalType] = useState<DisposalType>("sale");
  const [proceeds, setProceeds] = useState("0");
  const [disposalVat, setDisposalVat] = useState("0");
  const [settlementMethod, setSettlementMethod] = useState<SettlementMethod>("cash");
  const [proceedsAccount, setProceedsAccount] = useState("");
  const [counterparty, setCounterparty] = useState("");
  const [disposalRef, setDisposalRef] = useState("");
  const [disposalNotes, setDisposalNotes] = useState("");
  const disposingAsset = summaries.find((s) => s.id === disposeId) ?? null;
  const isSaleDisposal = disposalType === "sale" || disposalType === "trade_in";
  const disposalProceeds = isSaleDisposal ? Number(proceeds) || 0 : 0;

  const openDisposal = (assetId: string) => {
    setDisposeId(assetId);
    setDisposalType("sale");
    setProceeds("0");
    setDisposalVat("0");
    setSettlementMethod("cash");
    setProceedsAccount("");
    setCounterparty("");
    setDisposalRef("");
    setDisposalNotes("");
    setDisposalDate(format(new Date(), "yyyy-MM-dd"));
  };

  const submitDisposal = async () => {
    if (!disposeId) return;
    if (isSaleDisposal && disposalProceeds > 0 && settlementMethod === "none") {
      toast.error("Choose how the proceeds were received");
      return;
    }
    try {
      const result = await disposeAsset.mutateAsync({
        assetId: disposeId,
        disposalDate,
        disposalType,
        proceeds: disposalProceeds,
        vatAmount: isSaleDisposal ? Number(disposalVat) || 0 : 0,
        settlementMethod: disposalProceeds > 0 ? settlementMethod : "none",
        settlementAccountId:
          disposalProceeds > 0 && settlementMethod !== "receivable" ? proceedsAccount || null : null,
        counterparty: counterparty.trim() || null,
        reference: disposalRef.trim() || null,
        notes: disposalNotes.trim() || null,
      });
      const gain = Number(result.gain_loss);
      const outcome =
        gain >= 0 ? `gain of ${money(gain)}` : `loss of ${money(Math.abs(gain))}`;
      toast.success(
        result.settlement_status === "pending"
          ? `Disposal posted — ${outcome}. Amount is outstanding on Asset Disposal Receivable.`
          : `Disposal posted — ${outcome}`,
      );
      setDisposeId(null);
    } catch (e: any) {
      toast.error(e.message ?? "Could not dispose the asset");
    }
  };

  // ---- Disposal settlement --------------------------------------------
  const [settleId, setSettleId] = useState<string | null>(null);
  const [settleDate, setSettleDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [settleAccount, setSettleAccount] = useState("");
  const settlingDisposal = disposals.find((d) => d.id === settleId) ?? null;

  const submitSettlement = async () => {
    if (!settleId) return;
    try {
      const res = await settleDisposal.mutateAsync({
        disposalId: settleId,
        settledOn: settleDate,
        accountId: settleAccount || null,
      });
      toast.success(`Settlement posted — ${money(Number(res.amount))} received`);
      setSettleId(null);
    } catch (e: any) {
      toast.error(e.message ?? "Could not post the settlement");
    }
  };

  // ---- Export ----------------------------------------------------------
  const exportRegister = () => {
    exportToCSV({
      headers: [
        "Asset tag",
        "Name",
        "Class",
        "Branch",
        "Acquired",
        "Cost",
        "Life (months)",
        "Monthly depreciation",
        "Accumulated",
        "Net book value",
        "Status",
      ],
      rows: summaries.map((s) => [
        s.asset_tag ?? "-",
        s.name,
        s.className,
        branchName(s.branch_id),
        s.acquisition_date,
        Number(s.cost).toFixed(2),
        String(s.useful_life_months),
        s.monthlyDepreciation.toFixed(2),
        Number(s.accumulated_depreciation).toFixed(2),
        s.netBookValue.toFixed(2),
        s.status,
      ]),
      filename: `Fixed_Assets_${branchName(scopedBranchId).replace(/[^a-zA-Z0-9]+/g, "-")}`,
    });
  };

  return (
    <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 min-h-[56px]">
          <div className="min-w-[240px] flex-1"><h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight">Fixed Asset Register</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Equipment above the capitalization threshold is capitalized and depreciated. Anything below
            it is booked straight to expense, so smallwares never clutter the register.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <BranchScopeSelector hint="Assets and depreciation follow this branch" />
          <Button variant="outline" onClick={openSettings}>
            <Settings2 className="h-4 w-4 mr-2" />
            Policy
          </Button>
          <Button variant="outline" onClick={exportRegister} disabled={!summaries.length}>
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
          <Button onClick={() => setPurchaseOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Record equipment purchase
          </Button>
        </div>
      </div>

      {capexHandoff && (
        <Card className="border-primary/40">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <Landmark className="h-4 w-4 text-primary" />
              {capexHandoff.status === "pending"
                ? "Continue the blocked expense here"
                : "Purchase recorded — back to the expense"}
            </CardTitle>
            <CardDescription>
              {capexHandoff.status === "pending"
                ? `"${capexHandoff.draft?.description || "Your expense"}" was blocked because it used a fixed asset account. Record it below and the ledger entry, useful life and depreciation are created for you.`
                : capexHandoff.resolution?.kind === "capitalized"
                  ? "The asset and its ledger entry are posted. Nothing more to save in Expenses — return there to close the blocked entry."
                  : "It fell below the capitalization threshold, so the register booked it straight to expense. Return to Expenses to confirm and close the blocked entry."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {capexHandoff.status === "pending" && (
              <Button onClick={() => setPurchaseOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Open prefilled purchase
              </Button>
            )}
            <Button variant="outline" onClick={returnToExpense}>
              Return to the expense
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                clearCapexHandoff();
                setCapexHandoff(null);
              }}
            >
              Dismiss
            </Button>
          </CardContent>
        </Card>
      )}

      {needsSetup && (
        <Card className="border-amber-500/40">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Set up the register
            </CardTitle>
            <CardDescription>
              Provision the asset, accumulated depreciation and depreciation expense accounts along with
              the default asset classes (kitchen equipment, furniture, technology, vehicles, leasehold).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => bootstrap.mutate()} disabled={bootstrap.isPending}>
              Provision accounts and classes
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardHeader className="pb-3">
            <CardDescription className="flex items-center gap-2">
              <Landmark className="h-3.5 w-3.5" /> Capitalization threshold
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-xl font-light">{money(threshold)}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {settings?.auto_expense_below_threshold === false
                ? "Auto-expense off — everything capitalizes"
                : "Below this goes to expense"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription className="flex items-center gap-2">
              <Building2 className="h-3.5 w-3.5" /> Assets on register
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-xl font-light">{totals.count}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Gross cost</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-xl font-light">{money(totals.cost)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Accumulated depreciation</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-xl font-light">{money(totals.accumulated)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription className="flex items-center gap-2">
              <TrendingDown className="h-3.5 w-3.5" /> Net book value
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-xl font-light">{money(totals.netBookValue)}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {money(totals.monthlyCharge)} / month charge
            </p>
          </CardContent>
        </Card>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="register">Register</TabsTrigger>
          <TabsTrigger value="depreciation">Depreciation</TabsTrigger>
          <TabsTrigger value="disposals">Disposals</TabsTrigger>
          <TabsTrigger value="classes">Classes</TabsTrigger>
        </TabsList>

        <TabsContent value="register" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium">Assets</CardTitle>
              <CardDescription>{branchName(scopedBranchId)}</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Asset</TableHead>
                      <TableHead>Class</TableHead>
                      <TableHead>Branch</TableHead>
                      <TableHead>Acquired</TableHead>
                      <TableHead className="text-right">Cost</TableHead>
                      <TableHead className="text-right">Monthly</TableHead>
                      <TableHead className="text-right">Accumulated</TableHead>
                      <TableHead className="text-right">Net book value</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading && (
                      <TableRow>
                        <TableCell colSpan={10} className="text-center text-sm text-muted-foreground py-8">
                          Loading assets…
                        </TableCell>
                      </TableRow>
                    )}
                    {!isLoading && !summaries.length && (
                      <TableRow>
                        <TableCell colSpan={10} className="text-center text-sm text-muted-foreground py-8">
                          No capitalized assets yet. Below-threshold purchases stay in expenses by design.
                        </TableCell>
                      </TableRow>
                    )}
                    {summaries.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell>
                          <div className="font-medium">{s.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {s.asset_tag ? `${s.asset_tag} · ` : ""}
                            {s.supplier_name ?? "No supplier"}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">{s.className}</TableCell>
                        <TableCell className="text-sm">{branchName(s.branch_id)}</TableCell>
                        <TableCell className="text-sm">{s.acquisition_date}</TableCell>
                        <TableCell className="text-right">{money(Number(s.cost))}</TableCell>
                        <TableCell className="text-right">{money(s.monthlyDepreciation)}</TableCell>
                        <TableCell className="text-right">
                          {money(Number(s.accumulated_depreciation))}
                        </TableCell>
                        <TableCell className="text-right">{money(s.netBookValue)}</TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              s.status === "active"
                                ? "default"
                                : s.status === "disposed"
                                  ? "outline"
                                  : "secondary"
                            }
                          >
                            {s.status === "fully_depreciated" ? "Fully depreciated" : s.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            {assetInvoices[s.id] && (
                              <InvoiceActions
                                path={assetInvoices[s.id].url}
                                fileName={`invoice-${s.asset_tag || s.name}`}
                              />
                            )}
                            {s.status !== "disposed" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openDisposal(s.id)}
                            >
                              Dispose / write off
                            </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="depreciation" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium flex items-center gap-2">
                <CalendarClock className="h-4 w-4" />
                Automatic monthly job
              </CardTitle>
              <CardDescription>
                {settings?.auto_post_enabled === false
                  ? "Automatic posting is off — depreciation must be posted manually below."
                  : `Runs daily and posts the closed month on day ${settings?.auto_post_day ?? 1}, straight-line per asset class useful life.`}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-6 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Status</p>
                <Badge variant={settings?.auto_post_enabled === false ? "outline" : "secondary"}>
                  {settings?.auto_post_enabled === false ? "Disabled" : "Enabled"}
                </Badge>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Last month auto-posted</p>
                <p>
                  {settings?.last_auto_posted_month
                    ? format(new Date(settings.last_auto_posted_month), "MMM yyyy")
                    : "Not yet run"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Monthly charge at current register</p>
                <p>{money(totals.monthlyCharge)}</p>
              </div>
              <Button variant="outline" size="sm" onClick={openSettings}>
                Change schedule
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium flex items-center gap-2">
                <CalendarClock className="h-4 w-4" />
                Post monthly depreciation
              </CardTitle>
              <CardDescription>
                Posts DR depreciation expense / CR accumulated depreciation on the last day of the month.
                Each asset can only be depreciated once per month.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label>Month</Label>
                <Input
                  type="month"
                  value={depMonth}
                  onChange={(e) => setDepMonth(e.target.value)}
                  className="w-44"
                />
              </div>
              <Button onClick={runDepreciation} disabled={postDepreciation.isPending}>
                Post depreciation
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium">Run log</CardTitle>
              <CardDescription>Automatic and manual depreciation runs.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Run at</TableHead>
                      <TableHead>Period</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Assets</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!runs.length && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">
                          No depreciation runs recorded yet.
                        </TableCell>
                      </TableRow>
                    )}
                    {runs.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="text-sm text-muted-foreground">
                          {format(new Date(r.created_at), "yyyy-MM-dd HH:mm")}
                        </TableCell>
                        <TableCell>{format(new Date(r.period_month), "MMM yyyy")}</TableCell>
                        <TableCell className="capitalize">{r.run_type}</TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              r.status === "failed"
                                ? "destructive"
                                : r.status === "skipped"
                                  ? "outline"
                                  : "secondary"
                            }
                          >
                            {r.status}
                          </Badge>
                          {r.error_message && (
                            <p className="text-xs text-destructive mt-1 max-w-xs truncate" title={r.error_message}>
                              {r.error_message}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="text-right">{r.assets_count}</TableCell>
                        <TableCell className="text-right">{money(Number(r.total_amount))}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium">Depreciation history</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Period</TableHead>
                      <TableHead>Asset</TableHead>
                      <TableHead>Branch</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Posted</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!depreciation.length && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-8">
                          No depreciation posted yet.
                        </TableCell>
                      </TableRow>
                    )}
                    {depreciation.map((d) => (
                      <TableRow key={d.id}>
                        <TableCell>{format(new Date(d.period_month), "MMM yyyy")}</TableCell>
                        <TableCell>
                          {summaries.find((s) => s.id === d.asset_id)?.name ?? "Asset"}
                        </TableCell>
                        <TableCell>{branchName(d.branch_id)}</TableCell>
                        <TableCell className="text-right">{money(Number(d.amount))}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {format(new Date(d.posted_at), "yyyy-MM-dd")}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="disposals" className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Card>
              <CardHeader className="pb-3">
                <CardDescription>Assets disposed</CardDescription>
                <CardTitle className="text-base font-medium">{disposals.length}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardDescription>Net gain / (loss)</CardDescription>
                <CardTitle className="text-base font-medium">
                  {money(disposals.reduce((t, d) => t + Number(d.gain_loss || 0), 0))}
                </CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardDescription>Awaiting settlement</CardDescription>
                <CardTitle className="text-base font-medium">
                  {money(
                    disposals
                      .filter((d) => d.settlement_status === "pending")
                      .reduce((t, d) => t + Number(d.proceeds || 0) + Number(d.vat_amount || 0), 0),
                  )}
                </CardTitle>
              </CardHeader>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium">Disposal & write-off register</CardTitle>
              <CardDescription>
                Every removal from the register with its settlement details and posted gain or loss.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Asset</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>Counterparty</TableHead>
                      <TableHead className="text-right">Proceeds</TableHead>
                      <TableHead className="text-right">VAT</TableHead>
                      <TableHead className="text-right">Net book value</TableHead>
                      <TableHead className="text-right">Gain / (loss)</TableHead>
                      <TableHead>Settlement</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!disposals.length && (
                      <TableRow>
                        <TableCell colSpan={10} className="text-center text-sm text-muted-foreground py-8">
                          No disposals or write-offs recorded yet.
                        </TableCell>
                      </TableRow>
                    )}
                    {disposals.map((d) => {
                      const asset = summaries.find((s) => s.id === d.asset_id);
                      const gain = Number(d.gain_loss || 0);
                      return (
                        <TableRow key={d.id}>
                          <TableCell className="text-sm">{d.disposal_date}</TableCell>
                          <TableCell>
                            <div className="font-medium">{asset?.name ?? "Asset"}</div>
                            <div className="text-xs text-muted-foreground">
                              {branchName(d.branch_id)}
                              {d.reference_number ? ` · ${d.reference_number}` : ""}
                            </div>
                          </TableCell>
                          <TableCell className="text-sm capitalize">
                            {d.disposal_type.replace("_", " ")}
                          </TableCell>
                          <TableCell className="text-sm">{d.counterparty_name ?? "—"}</TableCell>
                          <TableCell className="text-right">{money(Number(d.proceeds))}</TableCell>
                          <TableCell className="text-right">{money(Number(d.vat_amount))}</TableCell>
                          <TableCell className="text-right">{money(Number(d.net_book_value))}</TableCell>
                          <TableCell
                            className={`text-right ${gain < 0 ? "text-destructive" : "text-primary"}`}
                          >
                            {money(gain)}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                d.settlement_method === "none"
                                  ? "outline"
                                  : d.settlement_status === "pending"
                                    ? "destructive"
                                    : "secondary"
                              }
                            >
                              {d.settlement_method === "none"
                                ? "No proceeds"
                                : d.settlement_status === "pending"
                                  ? "Outstanding"
                                  : `Settled · ${d.settlement_method}`}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            {d.settlement_status === "pending" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setSettleId(d.id);
                                  setSettleAccount("");
                                  setSettleDate(format(new Date(), "yyyy-MM-dd"));
                                }}
                              >
                                Record payment
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="classes" className="mt-4">
          <AssetClassTemplates
            allClasses={allClasses}
            branches={branches}
            scopeBranchId={scopedBranchId}
            canEdit={canManageClasses}
            saveClass={saveClass}
            copyClassesToBranch={copyClassesToBranch}
            deleteBranchClass={deleteBranchClass}
          />
        </TabsContent>
      </Tabs>

      {/* Policy dialog */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Capitalization policy</DialogTitle>
            <DialogDescription>
              Purchases at or above the threshold are capitalized; anything below goes straight to
              expense.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[70vh] pr-3">
            <div className="space-y-4">
              <div className="space-y-1">
                <Label>Capitalization threshold (per item, excluding VAT)</Label>
                <Input
                  type="number"
                  value={thresholdInput}
                  onChange={(e) => setThresholdInput(e.target.value)}
                />
              </div>
              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <p className="text-sm font-medium">Auto-expense below threshold</p>
                  <p className="text-xs text-muted-foreground">
                    Turn off to capitalize every equipment purchase regardless of value.
                  </p>
                </div>
                <Switch checked={autoExpense} onCheckedChange={setAutoExpense} />
              </div>
              <div className="space-y-1">
                <Label>Default useful life (months)</Label>
                <Input type="number" value={defaultLife} onChange={(e) => setDefaultLife(e.target.value)} />
              </div>
              <div className="rounded-md border p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Automatic monthly depreciation</p>
                    <p className="text-xs text-muted-foreground">
                      Posts the previous month automatically, per asset class useful life.
                    </p>
                  </div>
                  <Switch checked={autoPost} onCheckedChange={setAutoPost} />
                </div>
                {autoPost && (
                  <div className="space-y-1">
                    <Label>Run on day of month</Label>
                    <Input
                      type="number"
                      min={1}
                      max={28}
                      value={autoPostDay}
                      onChange={(e) => setAutoPostDay(e.target.value)}
                      className="w-28"
                    />
                    <p className="text-xs text-muted-foreground">
                      1–28. The job checks daily and posts the closed month once this day arrives.
                    </p>
                  </div>
                )}
              </div>
              <div className="space-y-1">
                <Label>Expense account for below-threshold purchases</Label>
                <Select value={defaultExpenseAccount} onValueChange={setDefaultExpenseAccount}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select expense account" />
                  </SelectTrigger>
                  <SelectContent className="z-50 bg-popover">
                    {expenseAccounts.map((a: any) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.account_code} — {a.account_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSettingsOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitSettings} disabled={saveSettings.isPending}>
              Save policy
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Record purchase dialog */}
      <Dialog open={purchaseOpen} onOpenChange={setPurchaseOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Record equipment purchase</DialogTitle>
            <DialogDescription>
              The threshold decides whether this is capitalized or expensed — you can override it per
              purchase.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[70vh] pr-3">
            <div className="space-y-4">
              <div className="grid md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Item name</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Deck oven" />
                </div>
                <div className="space-y-1">
                  <Label>Purchase cost</Label>
                  <Input type="number" value={cost} onChange={(e) => setCost(e.target.value)} />
                </div>
              </div>

              <div className="grid md:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label>VAT rate %</Label>
                  <Input type="number" value={vatRate} onChange={(e) => setVatRate(e.target.value)} />
                </div>
                <div className="space-y-1 md:col-span-2">
                  <Label>Price entered</Label>
                  <Select
                    value={vatIncluded ? "inclusive" : "exclusive"}
                    onValueChange={(v) => setVatIncluded(v === "inclusive")}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="z-50 bg-popover">
                      <SelectItem value="inclusive">VAT inclusive</SelectItem>
                      <SelectItem value="exclusive">VAT exclusive</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Asset class</Label>
                  <Select value={classId} onValueChange={setClassId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Kitchen Equipment" />
                    </SelectTrigger>
                    <SelectContent className="z-50 bg-popover">
                      {classes.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name} · {c.useful_life_months} months
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Purchase date</Label>
                  <Input
                    type="date"
                    value={purchaseDate}
                    onChange={(e) => setPurchaseDate(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid md:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label>Supplier</Label>
                  <Input value={supplier} onChange={(e) => setSupplier(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>Asset tag</Label>
                  <Input value={assetTag} onChange={(e) => setAssetTag(e.target.value)} placeholder="KE-014" />
                </div>
                <div className="space-y-1">
                  <Label>Useful life (months)</Label>
                  <Input
                    type="number"
                    value={life}
                    onChange={(e) => setLife(e.target.value)}
                    placeholder={String(selectedClass?.useful_life_months ?? 60)}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <Label>Project / cost center</Label>
                <Select value={projectId} onValueChange={setProjectId}>
                  <SelectTrigger>
                    <SelectValue placeholder="No project" />
                  </SelectTrigger>
                  <SelectContent className="z-50 bg-popover">
                    <SelectItem value="none">No project (operations)</SelectItem>
                    {projectList.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.code} — {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Tagging a project attributes the asset and its ledger entries to that project's spend.
                </p>
              </div>

              <div className="grid md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Paid with</Label>
                  <Select value={funding} onValueChange={(v) => setFunding(v as any)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="z-50 bg-popover">
                      <SelectItem value="company">Company cash / bank</SelectItem>
                      <SelectItem value="partner">Partner capital account</SelectItem>
                      <SelectItem value="credit">On credit (accounts payable)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {funding === "company" && (
                  <div className="space-y-1">
                    <Label>Cash / bank account</Label>
                    <Select value={paymentAccount} onValueChange={setPaymentAccount}>
                      <SelectTrigger>
                        <SelectValue placeholder="Cash on Hand" />
                      </SelectTrigger>
                      <SelectContent className="z-50 bg-popover">
                        {cashAccounts.map((a: any) => (
                          <SelectItem key={a.id} value={a.id}>
                            {a.account_code} — {a.account_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {funding === "partner" && (
                  <div className="space-y-1">
                    <Label>Partner account</Label>
                    <Select value={capitalAccount} onValueChange={setCapitalAccount}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select partner" />
                      </SelectTrigger>
                      <SelectContent className="z-50 bg-popover">
                        {capitalAccounts.map((c: any) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.partner_name} — {c.bank_name} ••{c.account_last4}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>

              <div className="grid md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Salvage value</Label>
                  <Input type="number" value={salvage} onChange={(e) => setSalvage(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>Treatment</Label>
                  <Select value={override} onValueChange={(v) => setOverride(v as any)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="z-50 bg-popover">
                      <SelectItem value="auto">Automatic (use threshold)</SelectItem>
                      <SelectItem value="capitalize">Force capitalize</SelectItem>
                      <SelectItem value="expense">Force expense</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {!willCapitalize && override === "auto" && (
                <div className="space-y-1">
                  <Label>Expense account (optional override)</Label>
                  <Select value={expenseAccount} onValueChange={setExpenseAccount}>
                    <SelectTrigger>
                      <SelectValue placeholder="Default below-threshold account" />
                    </SelectTrigger>
                    <SelectContent className="z-50 bg-popover">
                      {expenseAccounts.map((a: any) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.account_code} — {a.account_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="space-y-1">
                <Label>Notes</Label>
                <Textarea
                  value={purchaseNotes}
                  onChange={(e) => setPurchaseNotes(e.target.value)}
                  rows={2}
                />
              </div>

              <div className="rounded-md border p-3 space-y-1 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium">
                    {willCapitalize ? "Will be capitalized" : "Will be expensed"}
                  </span>
                  <Badge variant={willCapitalize ? "default" : "secondary"}>
                    threshold {money(threshold)}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  Net {money(netCost)} · Input VAT {money(vatAmount)}
                  {willCapitalize
                    ? ` · depreciated over ${effectiveLife} months (${money(
                        Math.round(((netCost - (Number(salvage) || 0)) / Math.max(effectiveLife, 1)) * 100) /
                          100,
                      )} / month)`
                    : " · no depreciation, full charge to P&L this period"}
                </p>
                <p className="text-xs text-muted-foreground">
                  Posting: DR {willCapitalize ? selectedClass?.name ?? "asset" : "expense"} {money(netCost)}
                  {vatAmount > 0 ? ` · DR Input VAT ${money(vatAmount)}` : ""} · CR{" "}
                  {funding === "credit"
                    ? "Accounts payable"
                    : funding === "partner"
                      ? "Partner capital"
                      : "cash / bank"}{" "}
                  {money(netCost + vatAmount)}
                </p>
              </div>
            </div>
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPurchaseOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitPurchase} disabled={recordPurchase.isPending}>
              Record purchase
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Disposal dialog */}
      <Dialog open={!!disposeId} onOpenChange={(o) => !o && setDisposeId(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Dispose or write off asset</DialogTitle>
            <DialogDescription>
              Removes cost and accumulated depreciation from the books and records the gain or loss.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[70vh] pr-3">
          <div className="space-y-4">
            {disposingAsset && (
              <div className="rounded-md border p-3 text-sm">
                <p className="font-medium">{disposingAsset.name}</p>
                <p className="text-xs text-muted-foreground">
                  Cost {money(Number(disposingAsset.cost))} · Accumulated{" "}
                  {money(Number(disposingAsset.accumulated_depreciation))} · Net book value{" "}
                  {money(disposingAsset.netBookValue)}
                </p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Reason</Label>
                <Select value={disposalType} onValueChange={(v) => setDisposalType(v as DisposalType)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="z-50 bg-popover">
                    <SelectItem value="sale">Sold</SelectItem>
                    <SelectItem value="trade_in">Traded in</SelectItem>
                    <SelectItem value="scrap">Scrapped</SelectItem>
                    <SelectItem value="write_off">Written off (damaged / obsolete)</SelectItem>
                    <SelectItem value="theft">Lost or stolen</SelectItem>
                    <SelectItem value="donation">Donated</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Disposal date</Label>
                <Input
                  type="date"
                  value={disposalDate}
                  onChange={(e) => setDisposalDate(e.target.value)}
                />
              </div>
            </div>

            {isSaleDisposal ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Sale amount (excl. VAT)</Label>
                    <Input type="number" value={proceeds} onChange={(e) => setProceeds(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label>Output VAT</Label>
                    <Input
                      type="number"
                      value={disposalVat}
                      onChange={(e) => setDisposalVat(e.target.value)}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Buyer / counterparty</Label>
                    <Input
                      value={counterparty}
                      onChange={(e) => setCounterparty(e.target.value)}
                      placeholder="Who bought it"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Invoice / reference</Label>
                    <Input value={disposalRef} onChange={(e) => setDisposalRef(e.target.value)} />
                  </div>
                </div>
              </>
            ) : (
              <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                No proceeds are recorded for this reason. The full remaining net book value is posted
                as a write-off loss (6965 Asset Write-off &amp; Shrinkage Loss).
              </div>
            )}

            {disposalProceeds > 0 && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Settled by</Label>
                  <Select
                    value={settlementMethod}
                    onValueChange={(v) => setSettlementMethod(v as SettlementMethod)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="z-50 bg-popover">
                      <SelectItem value="cash">Cash received</SelectItem>
                      <SelectItem value="bank">Bank transfer received</SelectItem>
                      <SelectItem value="receivable">On account (unpaid)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {settlementMethod !== "receivable" && (
                  <div className="space-y-1">
                    <Label>Received into</Label>
                    <Select value={proceedsAccount} onValueChange={setProceedsAccount}>
                      <SelectTrigger>
                        <SelectValue placeholder={settlementMethod === "bank" ? "Bank Account" : "Cash on Hand"} />
                      </SelectTrigger>
                      <SelectContent className="z-50 bg-popover">
                        {cashAccounts.map((a: any) => (
                          <SelectItem key={a.id} value={a.id}>
                            {a.account_code} — {a.account_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            )}

            <div className="space-y-1">
              <Label>Notes</Label>
              <Textarea
                value={disposalNotes}
                onChange={(e) => setDisposalNotes(e.target.value)}
                rows={2}
              />
            </div>

            {disposingAsset && (
              <div className="rounded-md bg-muted/50 p-3 text-xs space-y-1">
                <p className="font-medium">Ledger preview</p>
                <p>
                  DR accumulated depreciation {money(Number(disposingAsset.accumulated_depreciation))}
                </p>
                {disposalProceeds + (Number(disposalVat) || 0) > 0 && (
                  <p>
                    DR{" "}
                    {settlementMethod === "receivable"
                      ? "Asset Disposal Receivable"
                      : settlementMethod === "bank"
                        ? "Bank"
                        : "Cash"}{" "}
                    {money(disposalProceeds + (isSaleDisposal ? Number(disposalVat) || 0 : 0))}
                  </p>
                )}
                {isSaleDisposal && Number(disposalVat) > 0 && (
                  <p>CR VAT payable {money(Number(disposalVat))}</p>
                )}
                <p>CR asset cost {money(Number(disposingAsset.cost))}</p>
                <p className={disposalProceeds - disposingAsset.netBookValue < 0 ? "text-destructive" : "text-primary"}>
                  {disposalProceeds - disposingAsset.netBookValue >= 0
                    ? `CR gain on disposal ${money(disposalProceeds - disposingAsset.netBookValue)}`
                    : `DR ${isSaleDisposal ? "loss on disposal" : "write-off loss"} ${money(disposingAsset.netBookValue - disposalProceeds)}`}
                </p>
              </div>
            )}
          </div>
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisposeId(null)}>
              Cancel
            </Button>
            <Button onClick={submitDisposal} disabled={disposeAsset.isPending}>
              Post disposal
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Disposal settlement dialog */}
      <Dialog open={!!settleId} onOpenChange={(o) => !o && setSettleId(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Record disposal payment</DialogTitle>
            <DialogDescription>
              Clears the asset disposal receivable and books the money received.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {settlingDisposal && (
              <div className="rounded-md border p-3 text-sm">
                <p className="font-medium">
                  {summaries.find((s) => s.id === settlingDisposal.asset_id)?.name ?? "Asset"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {settlingDisposal.counterparty_name ?? "Buyer"} · outstanding{" "}
                  {money(Number(settlingDisposal.proceeds) + Number(settlingDisposal.vat_amount))}
                </p>
              </div>
            )}
            <div className="space-y-1">
              <Label>Payment date</Label>
              <Input type="date" value={settleDate} onChange={(e) => setSettleDate(e.target.value)} />
            </div>
              <div className="space-y-1">
              <Label>Received into</Label>
              <Select value={settleAccount} onValueChange={setSettleAccount}>
                  <SelectTrigger>
                    <SelectValue placeholder="Cash on Hand" />
                  </SelectTrigger>
                  <SelectContent className="z-50 bg-popover">
                    {cashAccounts.map((a: any) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.account_code} — {a.account_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSettleId(null)}>
              Cancel
            </Button>
            <Button onClick={submitSettlement} disabled={settleDisposal.isPending}>
              Post settlement
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
