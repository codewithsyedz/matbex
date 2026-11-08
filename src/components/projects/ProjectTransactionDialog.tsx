import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { AccountSelect } from "@/components/accounting/AccountSelect";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { useChartOfAccounts } from "@/hooks/useChartOfAccounts";
import { useCurrency } from "@/hooks/useCurrency";
import { useFixedAssets } from "@/hooks/useFixedAssets";
import {
  CONSTRUCTION_CATEGORIES,
  FUNDING_LABELS,
  TREATMENT_LABELS,
  type FundingClassification,
  type ProjectTransaction,
  type Treatment,
  type useProjects,
} from "@/hooks/useProjects";
import { readableError } from "./ProjectTransactionsTab";

type ProjectsApi = ReturnType<typeof useProjects>;

interface SplitDraft {
  account_id: string;
  category: string;
  amount: string;
}

export function ProjectTransactionDialog({
  api,
  open,
  onOpenChange,
  transaction,
}: {
  api: ProjectsApi;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  transaction: ProjectTransaction | null;
}) {
  const { accounts } = useChartOfAccounts();
  const { format: money } = useCurrency();
  const { classes: assetClasses } = useFixedAssets({ branchId: api.activeProject?.branch_id ?? undefined });
  const readOnly = transaction?.status === "posted";

  const [vendor, setVendor] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [treatment, setTreatment] = useState<Treatment | "">("");
  const [debitAccount, setDebitAccount] = useState("");
  const [paidBy, setPaidBy] = useState<"company" | "partner">("company");
  const [partnerId, setPartnerId] = useState("");
  const [paymentSource, setPaymentSource] = useState("company_bank");
  const [paymentAccount, setPaymentAccount] = useState("");
  const [funding, setFunding] = useState<FundingClassification | "">("payable");
  const [isPaid, setIsPaid] = useState(true);
  const [splits, setSplits] = useState<SplitDraft[]>([]);
  const [capitalize, setCapitalize] = useState(false);
  const [assetClassId, setAssetClassId] = useState("");
  const [assetName, setAssetName] = useState("");
  const [assetTag, setAssetTag] = useState("");
  const [assetLife, setAssetLife] = useState("");
  const [reclassReason, setReclassReason] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (transaction) {
      setVendor(transaction.vendor_name ?? "");
      setDate(transaction.txn_date);
      setAmount(String(transaction.amount));
      setDescription(transaction.description ?? "");
      setCategory(transaction.category ?? "");
      setTreatment(transaction.treatment ?? "");
      setDebitAccount(transaction.debit_account_id ?? "");
      setPaidBy(transaction.paid_by);
      setPartnerId(transaction.partner_id ?? "");
      setPaymentSource(transaction.payment_source ?? "company_bank");
      setPaymentAccount(transaction.payment_account_id ?? "");
      setFunding(transaction.funding_classification ?? "payable");
      setIsPaid(transaction.is_paid);
      setCapitalize(!!transaction.capitalize);
      setAssetClassId(transaction.asset_class_id ?? "");
      setAssetName(transaction.asset_name ?? "");
      setAssetTag(transaction.asset_tag ?? "");
      setAssetLife(transaction.asset_useful_life_months ? String(transaction.asset_useful_life_months) : "");
    } else {
      setVendor("");
      setDate(new Date().toISOString().slice(0, 10));
      setAmount("");
      setDescription("");
      setCategory("");
      setTreatment("");
      setDebitAccount("");
      setPaidBy("company");
      setPartnerId("");
      setPaymentSource("company_bank");
      setPaymentAccount("");
      setFunding("payable");
      setIsPaid(true);
      setCapitalize(false);
      setAssetClassId("");
      setAssetName("");
      setAssetTag("");
      setAssetLife("");
    }
    setSplits([]);
    setReclassReason("");
  }, [open, transaction]);

  const costAccounts = useMemo(
    () =>
      accounts.filter(
        (a) => a.is_active && (a.account_type === "asset" || a.account_type === "expense" || a.account_type === "cogs"),
      ),
    [accounts],
  );
  const cashAccounts = useMemo(
    () => accounts.filter((a) => a.is_active && a.account_type === "asset" && a.account_code < "1200"),
    [accounts],
  );

  const splitTotal = splits.reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const splitMismatch = splits.length > 0 && Math.abs(splitTotal - (Number(amount) || 0)) > 0.005;

  const suggestedTreatment = (cat: string): Treatment | "" => {
    if (!cat) return "";
    if (["Licensing", "Municipality / Balady"].includes(cat)) return "license";
    if (cat === "Pre-Opening") return "pre_opening";
    if (["Professional Fees", "Other"].includes(cat)) return "opex";
    return "capex";
  };

  const handleSave = async (andClassify: boolean) => {
    if (readOnly) return onOpenChange(false);
    const amt = Number(amount);
    if (!amt || amt <= 0) return toast.error("Enter an amount");
    if (paidBy === "partner" && !partnerId) return toast.error("Select which partner paid");
    if (splitMismatch) return toast.error("Split lines must equal the transaction amount");
    if (capitalize && treatment !== "capex")
      return toast.error("Only CAPEX transactions can create a fixed asset");
    if (capitalize && splits.length > 0)
      return toast.error("Remove split lines to capitalize this cost as a single asset");

    setSaving(true);
    try {
      const txnId = await api.saveTransaction.mutateAsync({
        id: transaction?.id,
        vendor_name: vendor || null,
        txn_date: date,
        amount: amt,
        description: description || null,
        category: category || null,
        treatment: (treatment || null) as Treatment | null,
        debit_account_id: splits.length > 0 ? null : debitAccount || null,
        paid_by: paidBy,
        partner_id: paidBy === "partner" ? partnerId : null,
        payment_source: paymentSource,
        payment_account_id: paidBy === "company" ? paymentAccount || null : null,
        funding_classification: paidBy === "partner" ? ((funding || null) as FundingClassification) : null,
        is_paid: isPaid,
        capitalize,
        asset_class_id: capitalize ? assetClassId || null : null,
        asset_name: capitalize ? assetName || description || vendor || null : null,
        asset_tag: capitalize ? assetTag || null : null,
        asset_useful_life_months: capitalize && Number(assetLife) ? Number(assetLife) : null,
        branch_id: api.activeProject?.branch_id ?? null,
        status: andClassify ? "classified" : transaction?.status ?? "needs_review",
      });

      if (splits.length > 0) {
        await api.saveSplits.mutateAsync({
          txnId,
          splits: splits.map((s) => ({
            account_id: s.account_id,
            category: s.category || null,
            treatment: (treatment || null) as Treatment | null,
            amount: Number(s.amount),
          })),
        });
      }

      toast.success(andClassify ? "Classified — ready to post" : "Saved");
      onOpenChange(false);
    } catch (e: any) {
      toast.error(readableError(e?.message));
    } finally {
      setSaving(false);
    }
  };

  const handleReclassify = async () => {
    if (!transaction || !funding) return;
    if (!reclassReason.trim()) return toast.error("A reason is required for reclassification");
    try {
      await api.reclassifyFunding.mutateAsync({
        txnId: transaction.id,
        classification: funding,
        reason: reclassReason.trim(),
      });
      toast.success("Reclassified — a correcting journal entry was posted");
      onOpenChange(false);
    } catch (e: any) {
      toast.error(readableError(e?.message));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{transaction ? "Review project cost" : "Record project cost"}</DialogTitle>
          <DialogDescription>
            Posts through the existing journal engine. Partner-funded costs are never auto-classified.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[65vh] pr-4">
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Date</Label>
                <Input type="date" value={date} disabled={readOnly} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Amount</Label>
                <Input
                  type="number"
                  value={amount}
                  disabled={readOnly}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Vendor</Label>
                <Input value={vendor} disabled={readOnly} onChange={(e) => setVendor(e.target.value)} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Description</Label>
              <Input
                value={description}
                disabled={readOnly}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Select
                  value={category}
                  disabled={readOnly}
                  onValueChange={(v) => {
                    setCategory(v);
                    if (!treatment) setTreatment(suggestedTreatment(v));
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    {CONSTRUCTION_CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Accounting treatment</Label>
                <Select
                  value={treatment}
                  disabled={readOnly}
                  onValueChange={(v) => setTreatment(v as Treatment)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="CAPEX / OPEX / …" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(TREATMENT_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>
                        {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {splits.length === 0 && (
              <div className="space-y-1.5">
                <Label>Cost account (debit)</Label>
                <AccountSelect
                  value={debitAccount}
                  disabled={readOnly || capitalize}
                  onValueChange={setDebitAccount}
                  accounts={costAccounts}
                  placeholder="Select account"
                  showDetail={false}
                />
                {capitalize && (
                  <p className="text-xs text-muted-foreground">
                    CAPEX routing: the debit posts to the asset account of the selected asset class.
                  </p>
                )}
              </div>
            )}

            {treatment === "capex" && splits.length === 0 && (
              <div className="space-y-2 rounded-md border p-3">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={capitalize}
                    disabled={readOnly}
                    onCheckedChange={(v) => setCapitalize(v === true)}
                  />
                  Create a fixed asset in the register when this is posted
                </label>
                {capitalize && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label>Asset class</Label>
                      <Select value={assetClassId} disabled={readOnly} onValueChange={setAssetClassId}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select asset class" />
                        </SelectTrigger>
                        <SelectContent>
                          {assetClasses.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.name} · {c.useful_life_months} months
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Asset name</Label>
                      <Input
                        value={assetName}
                        disabled={readOnly}
                        placeholder={description || "e.g. Cold room compressor"}
                        onChange={(e) => setAssetName(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Asset tag</Label>
                      <Input value={assetTag} disabled={readOnly} onChange={(e) => setAssetTag(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Useful life (months)</Label>
                      <Input
                        type="number"
                        value={assetLife}
                        disabled={readOnly}
                        placeholder="Class default"
                        onChange={(e) => setAssetLife(e.target.value)}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {!readOnly && (
              <div className="space-y-2 rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm">Split across categories</Label>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setSplits((s) => [...s, { account_id: "", category: "", amount: "" }])}
                  >
                    Add split line
                  </Button>
                </div>
                {splits.map((s, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1fr_110px_auto] gap-2">
                    <AccountSelect
                      value={s.account_id}
                      onValueChange={(v) =>
                        setSplits((prev) => prev.map((x, idx) => (idx === i ? { ...x, account_id: v } : x)))
                      }
                      accounts={costAccounts}
                      placeholder="Account"
                      showDetail={false}
                    />
                    <Select
                      value={s.category}
                      onValueChange={(v) =>
                        setSplits((prev) => prev.map((x, idx) => (idx === i ? { ...x, category: v } : x)))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Category" />
                      </SelectTrigger>
                      <SelectContent>
                        {CONSTRUCTION_CATEGORIES.map((c) => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      type="number"
                      value={s.amount}
                      placeholder="Amount"
                      onChange={(e) =>
                        setSplits((prev) =>
                          prev.map((x, idx) => (idx === i ? { ...x, amount: e.target.value } : x)),
                        )
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setSplits((prev) => prev.filter((_, idx) => idx !== i))}
                    >
                      Remove
                    </Button>
                  </div>
                ))}
                {splits.length > 0 && (
                  <p className={`text-xs ${splitMismatch ? "text-destructive" : "text-muted-foreground"}`}>
                    Split total {money(splitTotal)} of {money(Number(amount) || 0)}
                  </p>
                )}
              </div>
            )}

            <Separator />

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Paid by</Label>
                <Select
                  value={paidBy}
                  disabled={readOnly}
                  onValueChange={(v) => setPaidBy(v as "company" | "partner")}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="company">Company</SelectItem>
                    <SelectItem value="partner">Partner</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Payment source</Label>
                <Select value={paymentSource} disabled={readOnly} onValueChange={setPaymentSource}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="company_bank">Company bank</SelectItem>
                    <SelectItem value="company_cash">Company cash</SelectItem>
                    <SelectItem value="partner_bank">Partner personal bank</SelectItem>
                    <SelectItem value="partner_cash">Partner cash</SelectItem>
                    <SelectItem value="partner_card">Partner credit card</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {paidBy === "partner" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Partner</Label>
                  <Select value={partnerId} disabled={readOnly} onValueChange={setPartnerId}>
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
                  <Label>Partner funding classification</Label>
                  <Select value={funding} onValueChange={(v) => setFunding(v as FundingClassification)}>
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
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Company payment account</Label>
                  <Select value={paymentAccount} disabled={readOnly} onValueChange={setPaymentAccount}>
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
                <div className="flex items-end gap-2 pb-2">
                  <Checkbox
                    id="is-paid"
                    checked={isPaid}
                    disabled={readOnly}
                    onCheckedChange={(v) => setIsPaid(!!v)}
                  />
                  <Label htmlFor="is-paid" className="text-sm font-normal">
                    Already paid (otherwise posts to Accounts Payable)
                  </Label>
                </div>
              </div>
            )}

            {readOnly && transaction?.paid_by === "partner" && (
              <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
                <Label className="text-sm">Reclassify partner funding</Label>
                <p className="text-xs text-muted-foreground">
                  Posts a correcting journal entry and records who changed it and why. Nothing is deleted.
                </p>
                <Textarea
                  rows={2}
                  placeholder="Reason for reclassification"
                  value={reclassReason}
                  onChange={(e) => setReclassReason(e.target.value)}
                />
                <Button size="sm" variant="outline" onClick={handleReclassify}>
                  Reclassify to {funding ? FUNDING_LABELS[funding] : "…"}
                </Button>
              </div>
            )}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {!readOnly && (
            <>
              <Button variant="secondary" disabled={saving} onClick={() => handleSave(false)}>
                Save as needs review
              </Button>
              <Button disabled={saving} onClick={() => handleSave(true)}>
                Save &amp; mark classified
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}