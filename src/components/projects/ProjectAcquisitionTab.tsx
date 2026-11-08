import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { useChartOfAccounts } from "@/hooks/useChartOfAccounts";
import {
  applyResidualToLargest,
  balanceAmounts,
  classifyVariance,
  distributeEqually,
  isBalanced,
  round2,
} from "@/lib/splitBalance";
import { useCurrency } from "@/hooks/useCurrency";
import { useFixedAssets } from "@/hooks/useFixedAssets";
import { FUNDING_LABELS, type FundingClassification, type useProjects } from "@/hooks/useProjects";
import { readableError } from "./ProjectTransactionsTab";
import { AcquisitionExcelImportDialog, type ImportedAllocation } from "./AcquisitionExcelImportDialog";
import { PartnerMultiSelect } from "./PartnerMultiSelect";
import { AccountSelect } from "@/components/accounting/AccountSelect";
import { VatSplitField } from "@/components/accounting/VatSplitField";
import { splitVat, validateVatSplit } from "@/lib/vatSplit";
import { useBranchVatRate } from "@/hooks/useBranchVatRate";

type ProjectsApi = ReturnType<typeof useProjects>;

interface AllocDraft {
  account_id: string;
  label: string;
  amount: string;
  capitalize: boolean;
  asset_class_id: string;
  asset_life: string;
}

interface FunderDraft {
  paid_by: "company" | "partner";
  partner_id: string;
  funding: FundingClassification;
  payment_account_id: string;
  amount: string;
}

export function ProjectAcquisitionTab({ api }: { api: ProjectsApi }) {
  const { accounts } = useChartOfAccounts();
  const { format: money } = useCurrency();
  const { classes } = useFixedAssets({ branchId: api.activeProject?.branch_id ?? undefined });
  const acq = api.acquisition;
  const posted = acq?.classification_status === "posted";

  const [seller, setSeller] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState("");
  // VAT split — the purchase price is the gross paid to the seller; allocations
  // must cover the net, and the VAT portion posts to 1180 Input VAT.
  const [vatEnabled, setVatEnabled] = useState(false);
  const [vatInclusive, setVatInclusive] = useState(true);
  const [vatRatePercent, setVatRatePercent] = useState("");
  const [paidBy, setPaidBy] = useState<"company" | "partner" | "split">("partner");
  const [partnerId, setPartnerId] = useState("");
  const [funding, setFunding] = useState<FundingClassification>("capital");
  const [paymentAccount, setPaymentAccount] = useState("");
  const [funders, setFunders] = useState<FunderDraft[]>([]);
  const [autoBalance, setAutoBalance] = useState(true);
  const [allocs, setAllocs] = useState<AllocDraft[]>([]);
  const [importOpen, setImportOpen] = useState(false);

  const applyImport = (lines: ImportedAllocation[], importedTotal: number) => {
    setAllocs((prev) => [
      ...prev,
      ...lines.map((l) => ({
        account_id: l.account_id ?? "",
        label: l.label,
        amount: String(l.amount),
        capitalize: false,
        asset_class_id: "",
        asset_life: "",
      })),
    ]);
    setAmount((prev) => {
      const current = Number(prev) || 0;
      return current > 0 ? prev : String(importedTotal);
    });
  };

  useEffect(() => {
    if (acq) {
      setSeller(acq.seller_name ?? "");
      setDate(acq.acquisition_date);
      setAmount(String(acq.amount));
      setPaidBy(api.acquisitionFunders.length > 0 ? "split" : acq.paid_by);
      setPartnerId(acq.partner_id ?? "");
      setFunding(acq.funding_classification ?? "capital");
      setPaymentAccount(acq.payment_account_id ?? "");
      const acqVat = Number((acq as any).vat_amount ?? 0);
      setVatEnabled(acqVat > 0);
      setVatInclusive((acq as any).vat_inclusive ?? true);
      setVatRatePercent((acq as any).vat_rate ? String((acq as any).vat_rate) : "");
    }
    setFunders(
      api.acquisitionFunders.map((f) => ({
        paid_by: f.paid_by,
        partner_id: f.partner_id ?? "",
        funding: (f.funding_classification ?? "capital") as FundingClassification,
        payment_account_id: f.payment_account_id ?? "",
        amount: String(f.amount),
      })),
    );
    setAllocs(
      api.allocations.map((a) => ({
        account_id: a.account_id,
        label: a.label,
        amount: String(a.amount),
        capitalize: !!a.capitalize,
        asset_class_id: a.asset_class_id ?? "",
        asset_life: a.asset_useful_life_months ? String(a.asset_useful_life_months) : "",
      })),
    );
  }, [acq, api.allocations, api.acquisitionFunders]);

  const assetAccounts = useMemo(
    () => accounts.filter((a) => a.is_active && (a.account_type === "asset" || a.account_type === "expense")),
    [accounts],
  );
  const cashAccounts = useMemo(
    () => accounts.filter((a) => a.is_active && a.account_type === "asset" && a.account_code < "1200"),
    [accounts],
  );

  const { vatPercent: branchVatPercent } = useBranchVatRate(
    api.activeProject?.branch_id ?? null,
  );
  const effectiveVatRate =
    vatRatePercent !== "" ? Number(vatRatePercent) || 0 : branchVatPercent;
  // The purchase price field is treated as gross; funding settles the gross,
  // allocations only cover the net (VAT is recoverable, not part of the asset cost).
  const vatSplit = splitVat({
    amount: Number(amount) || 0,
    ratePercent: effectiveVatRate,
    inclusive: vatInclusive,
    vatEnabled,
  });
  const total = vatSplit.gross;
  const netPrice = vatSplit.net;
  const allocated = allocs.reduce((s, a) => s + (Number(a.amount) || 0), 0);
  const unallocated = round2(netPrice - allocated);
  const funded = funders.reduce((s, f) => s + (Number(f.amount) || 0), 0);
  const unfunded = total - funded;
  const funderAmounts = funders.map((f) => Number(f.amount) || 0);
  const variance = total > 0 && funders.length > 0 ? classifyVariance(funderAmounts, total) : "balanced";

  const setFunder = (i: number, patch: Partial<FunderDraft>) =>
    setFunders((prev) => prev.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));

  /** Rewrite the funder amounts from a numeric array, keeping blanks out of the UI. */
  const writeAmounts = (rows: FunderDraft[], values: number[]) =>
    rows.map((f, i) => ({ ...f, amount: String(values[i] ?? 0) }));

  /** Edit one line's amount and, when auto-balance is on, re-spread the rest pro-rata. */
  const setFunderAmount = (i: number, raw: string) =>
    setFunders((prev) => {
      const edited = prev.map((f, idx) => (idx === i ? { ...f, amount: raw } : f));
      if (!autoBalance || !total || edited.length < 2) return edited;
      const values = edited.map((f) => Number(f.amount) || 0);
      return writeAmounts(edited, balanceAmounts(values, total, i));
    });

  const rebalanceAll = (rows: FunderDraft[] = funders) => {
    if (!total || rows.length === 0) return rows;
    return writeAmounts(rows, balanceAmounts(rows.map((f) => Number(f.amount) || 0), total));
  };

  /** Append one or more funding lines, giving new lines the unfunded remainder (or an even re-spread). */
  const addFunderLines = (drafts: FunderDraft[]) =>
    setFunders((prev) => {
      const next = [...prev, ...drafts];
      if (!total) return next;
      const values = next.map((f) => Number(f.amount) || 0);
      const priorSum = prev.reduce((s, f) => s + (Number(f.amount) || 0), 0);
      const remainder = round2(total - priorSum);
      if (remainder > 0) {
        const share = distributeEqually(remainder, drafts.length);
        drafts.forEach((_, k) => {
          values[prev.length + k] = share[k];
        });
        return writeAmounts(next, values);
      }
      if (!autoBalance) return next;
      return writeAmounts(next, distributeEqually(total, next.length));
    });

  const removeFunderLine = (i: number) =>
    setFunders((prev) => {
      const next = prev.filter((_, idx) => idx !== i);
      if (!autoBalance || !total || next.length === 0) return next;
      return writeAmounts(next, balanceAmounts(next.map((f) => Number(f.amount) || 0), total));
    });

  const blankPartnerLine = (partnerId = ""): FunderDraft => ({
    paid_by: "partner",
    partner_id: partnerId,
    funding: "capital",
    payment_account_id: "",
    amount: "",
  });

  // Keep the split in sync when the purchase price itself changes.
  useEffect(() => {
    if (!autoBalance || paidBy !== "split" || !total) return;
    setFunders((prev) => {
      if (prev.length === 0 || isBalanced(prev.map((f) => Number(f.amount) || 0), total)) return prev;
      return writeAmounts(prev, balanceAmounts(prev.map((f) => Number(f.amount) || 0), total));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total, autoBalance, paidBy]);

  const handleSave = async () => {
    if (!total) return toast.error("Enter the acquisition amount");
    if (vatEnabled) {
      const vatIssue = validateVatSplit(vatSplit);
      if (vatIssue) return toast.error(vatIssue);
      if (!(effectiveVatRate > 0))
        return toast.error("Enter a VAT rate or turn the VAT split off");
    }
    if (paidBy === "partner" && !partnerId) return toast.error("Select the paying partner");
    const splitRows = funders.filter((f) => Number(f.amount) > 0);
    if (paidBy === "split") {
      if (splitRows.length === 0) return toast.error("Add at least one funding source");
      if (splitRows.some((f) => f.paid_by === "partner" && !f.partner_id))
        return toast.error("Select a partner for every partner-funded line");
      if (Math.abs(unfunded) > 0.01)
        return toast.error("The funding split must equal the purchase price exactly");
    }
    try {
      const id = await api.saveAcquisition.mutateAsync({
        id: acq?.id,
        acquisition_date: date,
        seller_name: seller,
        amount: total,
        vat_amount: vatSplit.vat,
        vat_inclusive: vatInclusive,
        vat_rate: vatEnabled ? effectiveVatRate : null,
        paid_by: paidBy === "split" ? "partner" : paidBy,
        partner_id:
          paidBy === "partner"
            ? partnerId
            : paidBy === "split"
              ? (splitRows.find((f) => f.paid_by === "partner")?.partner_id ?? null)
              : null,
        funding_classification:
          paidBy === "partner"
            ? funding
            : paidBy === "split"
              ? (splitRows.find((f) => f.paid_by === "partner")?.funding ?? null)
              : null,
        payment_account_id: paidBy === "company" ? paymentAccount || null : null,
        branch_id: api.activeProject?.branch_id ?? null,
        classification_status: Math.abs(unallocated) < 0.01 && allocs.length > 0 ? "classified" : "pending",
      });
      const acqId = (id as string) ?? acq?.id;
      if (acqId) {
        await api.saveFunders.mutateAsync({
          acquisitionId: acqId,
          funders:
            paidBy === "split"
              ? splitRows.map((f) => ({
                  paid_by: f.paid_by,
                  partner_id: f.paid_by === "partner" ? f.partner_id : null,
                  funding_classification: f.paid_by === "partner" ? f.funding : null,
                  payment_account_id: f.paid_by === "company" ? f.payment_account_id || null : null,
                  amount: Number(f.amount),
                }))
              : [],
        });
        await api.saveAllocations.mutateAsync({
          acquisitionId: acqId,
          allocations: allocs
            .filter((a) => a.account_id && Number(a.amount))
            .map((a) => ({
              account_id: a.account_id,
              label: a.label || "Allocation",
              amount: Number(a.amount),
              capitalize: a.capitalize,
              asset_class_id: a.capitalize ? a.asset_class_id || null : null,
              asset_useful_life_months: a.capitalize && Number(a.asset_life) ? Number(a.asset_life) : null,
            })),
        });
      }
      toast.success("Acquisition saved");
    } catch (e: any) {
      toast.error(readableError(e?.message));
    }
  };

  const handlePost = async () => {
    if (!acq) return;
    try {
      await api.postAcquisition.mutateAsync(acq.id);
      toast.success("Acquisition posted to the general ledger");
    } catch (e: any) {
      toast.error(readableError(e?.message));
    }
  };

  return (
    <div className="space-y-4">
      {posted && (
        <Alert>
          <AlertDescription>
            This acquisition is posted to the ledger and is now read-only. Corrections must go through a
            journal adjustment so the audit trail stays intact.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base font-medium">Business acquisition</CardTitle>
          {acq && <Badge variant={posted ? "default" : "secondary"}>{acq.classification_status}</Badge>}
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Seller</Label>
              <Input value={seller} disabled={posted} onChange={(e) => setSeller(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Acquisition date</Label>
              <Input type="date" value={date} disabled={posted} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Purchase price</Label>
              <Input
                type="number"
                value={amount}
                disabled={posted}
                onChange={(e) => setAmount(e.target.value)}
              />
              {vatEnabled && vatSplit.vat > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  Net {money(netPrice)} + VAT {money(vatSplit.vat)} = {money(total)}
                </p>
              )}
            </div>
          </div>

          <VatSplitField
            split={vatSplit}
            vatEnabled={vatEnabled}
            onVatEnabledChange={setVatEnabled}
            inclusive={vatInclusive}
            onInclusiveChange={setVatInclusive}
            ratePercent={
              vatRatePercent !== ""
                ? vatRatePercent
                : branchVatPercent
                  ? String(branchVatPercent)
                  : ""
            }
            onRatePercentChange={setVatRatePercent}
            kind="input"
            netAccountLabel="Acquired asset accounts (net)"
            disabled={posted}
          />

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Paid by</Label>
              <Select
                value={paidBy}
                disabled={posted}
                onValueChange={(v) => {
                  const next = v as "company" | "partner" | "split";
                  setPaidBy(next);
                  if (next === "split" && funders.length === 0) {
                    setFunders([
                      { paid_by: "partner", partner_id: partnerId, funding, payment_account_id: "", amount: "" },
                    ]);
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="company">Company</SelectItem>
                  <SelectItem value="partner">Partner</SelectItem>
                  <SelectItem value="split">Multiple partners / sources</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {paidBy === "split" ? null : paidBy === "partner" ? (
              <>
                <div className="space-y-1.5">
                  <Label>Partner</Label>
                  <PartnerMultiSelect
                    partners={api.partners}
                    disabled={posted}
                    value={partnerId ? [partnerId] : []}
                    onChange={(ids) => {
                      if (ids.length <= 1) {
                        setPartnerId(ids[0] ?? "");
                        return;
                      }
                      // Multiple partners → switch to a split and seed one line per partner.
                      const total = Number(amount) || 0;
                      const share = total > 0 ? Math.round((total / ids.length) * 100) / 100 : 0;
                      const rows = ids.map((id, i) => ({
                        paid_by: "partner" as const,
                        partner_id: id,
                        funding,
                        payment_account_id: "",
                        amount:
                          total > 0
                            ? String(
                                i === ids.length - 1
                                  ? Math.round((total - share * (ids.length - 1)) * 100) / 100
                                  : share,
                              )
                            : "",
                      }));
                      setPartnerId(ids[0]);
                      setFunders(rows);
                      setPaidBy("split");
                      toast.info(`${ids.length} partners selected — split the purchase price below`);
                    }}
                  />
                  <p className="text-xs text-muted-foreground">
                    Pick more than one to split the price across partners.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label>Funding classification</Label>
                  <Select
                    value={funding}
                    disabled={posted}
                    onValueChange={(v) => setFunding(v as FundingClassification)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(FUNDING_LABELS).map(([k, v]) => (
                        <SelectItem key={k} value={k}>
                          {v}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            ) : (
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Company payment account</Label>
                <Select value={paymentAccount} disabled={posted} onValueChange={setPaymentAccount}>
                  <SelectTrigger>
                    <SelectValue placeholder="Cash / bank" />
                  </SelectTrigger>
                  <SelectContent>
                    {cashAccounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.account_code} — {a.account_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {paidBy === "split" && (
            <div className="space-y-2 rounded-md border p-3">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Funding sources</Label>
                  <p className="text-xs text-muted-foreground">
                    Split who paid the purchase price across partners and/or the company.
                  </p>
                </div>
                {!posted && (
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="w-52">
                      <PartnerMultiSelect
                        partners={api.partners.filter((p) => !funders.some((f) => f.partner_id === p.id))}
                        value={[]}
                        placeholder="Add partners"
                        onChange={(ids) => {
                          if (ids.length === 0) return;
                          addFunderLines(ids.map((id) => blankPartnerLine(id)));
                        }}
                      />
                    </div>
                    <Button size="sm" variant="outline" onClick={() => addFunderLines([blankPartnerLine()])}>
                      Add partner line
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        addFunderLines([
                          {
                            paid_by: "company",
                            partner_id: "",
                            funding: "capital",
                            payment_account_id: "",
                            amount: "",
                          },
                        ])
                      }
                    >
                      Add company line
                    </Button>
                  </div>
                )}
              </div>

              {funders.length === 0 && (
                <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                  No funding lines yet — add partners or a company account to split the purchase price.
                </p>
              )}

              {funders.map((f, i) => (
                <div key={i} className="grid gap-2 sm:grid-cols-[140px_1fr_1fr_140px_auto] sm:items-end">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Source</Label>
                    <Select
                      value={f.paid_by}
                      disabled={posted}
                      onValueChange={(v) => setFunder(i, { paid_by: v as "company" | "partner" })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="partner">Partner</SelectItem>
                        <SelectItem value="company">Company</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {f.paid_by === "partner" ? (
                    <>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Partner</Label>
                        <Select
                          value={f.partner_id}
                          disabled={posted}
                          onValueChange={(v) => setFunder(i, { partner_id: v })}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select partner" />
                          </SelectTrigger>
                          <SelectContent>
                            {api.partners.map((p) => (
                              <SelectItem key={p.id} value={p.id}>
                                {p.partner_name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Classification</Label>
                        <Select
                          value={f.funding}
                          disabled={posted}
                          onValueChange={(v) => setFunder(i, { funding: v as FundingClassification })}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(FUNDING_LABELS).map(([k, v]) => (
                              <SelectItem key={k} value={k}>
                                {v}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </>
                  ) : (
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label className="text-xs">Company payment account</Label>
                      <Select
                        value={f.payment_account_id}
                        disabled={posted}
                        onValueChange={(v) => setFunder(i, { payment_account_id: v })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Cash / bank" />
                        </SelectTrigger>
                        <SelectContent>
                          {cashAccounts.map((a) => (
                            <SelectItem key={a.id} value={a.id}>
                              {a.account_code} — {a.account_name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <Label className="text-xs">Amount</Label>
                    <Input
                      type="number"
                      value={f.amount}
                      disabled={posted}
                      onChange={(e) => setFunderAmount(i, e.target.value)}
                    />
                  </div>

                  {!posted && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => removeFunderLine(i)}
                    >
                      Remove
                    </Button>
                  )}
                </div>
              ))}

              {!posted && variance !== "balanced" && (
                <Alert variant={variance === "rounding" ? "default" : "destructive"}>
                  <AlertDescription className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span>
                      {variance === "rounding"
                        ? `Rounding difference of ${money(Math.abs(unfunded))} — the split is ${
                            unfunded > 0 ? "short of" : "over"
                          } the purchase price.`
                        : `The funding split is off by ${money(Math.abs(unfunded))} (${
                            unfunded > 0 ? "under-funded" : "over-funded"
                          }). It must equal the purchase price ${money(total)} before saving.`}
                    </span>
                    <span className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setFunders((prev) =>
                            writeAmounts(
                              prev,
                              applyResidualToLargest(
                                prev.map((f) => Number(f.amount) || 0),
                                total,
                              ),
                            ),
                          )
                        }
                      >
                        Fix on largest line
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setFunders((prev) => rebalanceAll(prev))}>
                        Spread pro-rata
                      </Button>
                    </span>
                  </AlertDescription>
                </Alert>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <p className={`text-xs ${Math.abs(unfunded) < 0.01 ? "text-muted-foreground" : "text-destructive"}`}>
                  Funded {money(funded)} of {money(total)} · Unfunded {money(unfunded)}
                </p>
                {!posted && (
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                      <Switch id="auto-balance-split" checked={autoBalance} onCheckedChange={setAutoBalance} />
                      <Label htmlFor="auto-balance-split" className="text-xs font-normal">
                        Auto-balance to purchase price
                      </Label>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!total || funders.length === 0 || Math.abs(unfunded) < 0.01}
                      onClick={() => setFunders((prev) => rebalanceAll(prev))}
                    >
                      Balance now
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}

          <Separator />

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <Label>Purchase price allocation</Label>
                <p className="text-xs text-muted-foreground">
                  Split the price across the assets acquired; the residual is goodwill.
                </p>
              </div>
              {!posted && (
                <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
                  Import Excel
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setAllocs((a) => [
                      ...a,
                      { account_id: "", label: "", amount: "", capitalize: false, asset_class_id: "", asset_life: "" },
                    ])
                  }
                >
                  Add allocation
                </Button>
                </div>
              )}
            </div>

            {allocs.map((a, i) => (
              <div key={i} className="space-y-2 rounded-md border p-2">
                <div className="grid grid-cols-[1.4fr_1fr_130px_auto] gap-2">
                <AccountSelect
                  value={a.account_id}
                  accounts={assetAccounts}
                  disabled={posted}
                  placeholder="Account"
                  onValueChange={(v) =>
                    setAllocs((prev) => prev.map((x, idx) => (idx === i ? { ...x, account_id: v } : x)))
                  }
                />
                <Input
                  placeholder="Label"
                  value={a.label}
                  disabled={posted}
                  onChange={(e) =>
                    setAllocs((prev) => prev.map((x, idx) => (idx === i ? { ...x, label: e.target.value } : x)))
                  }
                />
                <Input
                  type="number"
                  placeholder="Amount"
                  value={a.amount}
                  disabled={posted}
                  onChange={(e) =>
                    setAllocs((prev) => prev.map((x, idx) => (idx === i ? { ...x, amount: e.target.value } : x)))
                  }
                />
                {!posted && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setAllocs((prev) => prev.filter((_, idx) => idx !== i))}
                  >
                    Remove
                  </Button>
                )}
                </div>
                <div className="flex flex-wrap items-center gap-3 pl-1">
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Checkbox
                      checked={a.capitalize}
                      disabled={posted}
                      onCheckedChange={(v) =>
                        setAllocs((prev) =>
                          prev.map((x, idx) => (idx === i ? { ...x, capitalize: v === true } : x)),
                        )
                      }
                    />
                    Create a fixed asset for this line
                  </label>
                  {a.capitalize && (
                    <>
                      <Select
                        value={a.asset_class_id}
                        disabled={posted}
                        onValueChange={(v) =>
                          setAllocs((prev) => prev.map((x, idx) => (idx === i ? { ...x, asset_class_id: v } : x)))
                        }
                      >
                        <SelectTrigger className="h-8 w-[220px]">
                          <SelectValue placeholder="Asset class" />
                        </SelectTrigger>
                        <SelectContent>
                          {classes.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.name} · {c.useful_life_months} months
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        className="h-8 w-[150px]"
                        type="number"
                        placeholder="Useful life (months)"
                        value={a.asset_life}
                        disabled={posted}
                        onChange={(e) =>
                          setAllocs((prev) =>
                            prev.map((x, idx) => (idx === i ? { ...x, asset_life: e.target.value } : x)),
                          )
                        }
                      />
                    </>
                  )}
                </div>
              </div>
            ))}

            <p className={`text-sm ${Math.abs(unallocated) > 0.01 ? "text-destructive" : "text-muted-foreground"}`}>
              Allocated {money(allocated)} of {money(netPrice)} net
              {vatEnabled && vatSplit.vat > 0 ? ` (VAT ${money(vatSplit.vat)} posts to Input VAT)` : ""} ·
              Unallocated {money(unallocated)}
            </p>
          </div>

          {!posted && (
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={handleSave}>
                Save
              </Button>
              <Button onClick={handlePost} disabled={!acq || Math.abs(unallocated) > 0.01 || allocs.length === 0}>
                Post to ledger
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <AcquisitionExcelImportDialog open={importOpen} onOpenChange={setImportOpen} onApply={applyImport} />
    </div>
  );
}