import { useMemo, useState } from "react";
import { format } from "date-fns";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Banknote, Landmark, RotateCcw } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useCurrency } from "@/hooks/useCurrency";
import { AccountSelect } from "@/components/accounting/AccountSelect";
import { useChartOfAccounts } from "@/hooks/useChartOfAccounts";

interface VatRemittancePanelProps {
  restaurantId?: string;
  /** Period being filed — pre-fills the remittance form. */
  periodStart?: string;
  periodEnd?: string;
  vatReturnId?: string | null;
}

interface RemittanceRow {
  id: string;
  payment_date: string;
  amount: number;
  reference: string | null;
  notes: string | null;
  branch_id: string | null;
  is_voided: boolean;
  void_reason: string | null;
  payment_account_id: string;
  journal_batch_id: string | null;
}

export function VatRemittancePanel({
  restaurantId,
  periodStart,
  periodEnd,
  vatReturnId,
}: VatRemittancePanelProps) {
  const { tenant } = useAuth() as any;
  const { branches, activeBranchId, pinnedBranchId } = useBranch();
  const { format: fmtMoney } = useCurrency();
  const queryClient = useQueryClient();
  const { accounts } = useChartOfAccounts();

  const tenantId = restaurantId ?? tenant?.id;
  const [branchId, setBranchId] = useState<string>(pinnedBranchId ?? activeBranchId ?? "all");
  const [open, setOpen] = useState(false);
  const [paymentDate, setPaymentDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [amount, setAmount] = useState("");
  const [paymentAccountId, setPaymentAccountId] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");

  const cashAndBankAccounts = useMemo(
    () => (accounts ?? []).filter((a) => a.account_type === "asset" && /^1(0|1)\d\d$/.test(a.account_code)),
    [accounts],
  );

  const vatAccount = useMemo(
    () => (accounts ?? []).find((a) => a.account_code === "2200"),
    [accounts],
  );

  const balanceQ = useQuery({
    queryKey: ["vat-payable-balance", tenantId, branchId],
    enabled: !!tenantId && !!vatAccount?.id,
    queryFn: async () => {
      let q = db
        .from("account_transactions")
        .select("debit, credit")
        .eq("tenant_id", tenantId)
        .eq("account_id", vatAccount!.id)
        .or("is_voided.is.null,is_voided.eq.false");
      if (branchId !== "all") q = q.eq("branch_id", branchId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).reduce(
        (sum: number, r: any) => sum + Number(r.credit ?? 0) - Number(r.debit ?? 0),
        0,
      );
    },
  });

  const remittancesQ = useQuery({
    queryKey: ["vat-remittances", tenantId, branchId],
    enabled: !!tenantId,
    queryFn: async () => {
      let q = db
        .from("vat_remittances" as any)
        .select("*")
        .eq("tenant_id", tenantId)
        .order("payment_date", { ascending: false })
        .limit(50);
      if (branchId !== "all") q = q.eq("branch_id", branchId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as RemittanceRow[];
    },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["vat-remittances"] });
    queryClient.invalidateQueries({ queryKey: ["vat-payable-balance"] });
    queryClient.invalidateQueries({ queryKey: ["trial-balance"] });
    queryClient.invalidateQueries({ queryKey: ["ledger"] });
  };

  const postMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await db.rpc("post_vat_remittance" as any, {
        p_payment_date: paymentDate,
        p_amount: Number(amount),
        p_payment_account_id: paymentAccountId,
        p_branch_id: branchId === "all" ? null : branchId,
        p_vat_return_id: vatReturnId ?? null,
        p_period_start: periodStart ?? null,
        p_period_end: periodEnd ?? null,
        p_reference: reference || null,
        p_notes: notes || null,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("VAT remittance posted", {
        description: "2200 VAT Payable has been debited and the paying account credited.",
      });
      setOpen(false);
      setAmount("");
      setReference("");
      setNotes("");
      invalidate();
    },
    onError: (e: any) => {
      const msg = String(e?.message ?? e);
      toast.error("Could not post the VAT remittance", {
        description: msg.replace(/^.*?(VAT_[A-Z_]+ERROR:\s*)?/, ""),
      });
    },
  });

  const voidMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.rpc("void_vat_remittance" as any, {
        p_remittance_id: id,
        p_reason: "Voided from VAT return screen",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("VAT remittance voided — the ledger entry has been reversed");
      invalidate();
    },
    onError: (e: any) => toast.error(String(e?.message ?? e)),
  });

  const outstanding = balanceQ.data ?? 0;
  const canSubmit =
    !!paymentAccountId && Number(amount) > 0 && !postMutation.isPending;

  const accountName = (id: string) => {
    const a = (accounts ?? []).find((x) => x.id === id);
    return a ? `${a.account_code} — ${a.account_name}` : "—";
  };

  const branchName = (id: string | null) =>
    id ? branches.find((b) => b.id === id)?.name ?? "Branch" : "All branches";

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <Landmark className="h-4 w-4 text-muted-foreground" />
              VAT remittance to the tax authority
            </CardTitle>
            <CardDescription>
              Records the payment as DR 2200 VAT Payable / CR your cash or bank account, so the
              liability clears on the trial balance.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Select value={branchId} onValueChange={setBranchId}>
              <SelectTrigger className="w-[190px]">
                <SelectValue placeholder="Branch" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All branches</SelectItem>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" onClick={() => setOpen(true)} disabled={!vatAccount}>
              <Banknote className="h-4 w-4 mr-1.5" />
              Record payment
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {!vatAccount && (
          <Alert variant="destructive">
            <AlertDescription>
              Account 2200 VAT Payable is missing from the Chart of Accounts. Add it before
              recording a remittance.
            </AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Outstanding VAT payable (2200)</p>
            {balanceQ.isLoading ? (
              <Skeleton className="h-6 w-28 mt-1" />
            ) : (
              <p className="font-display text-xl font-semibold tabular-nums mt-0.5">{fmtMoney(outstanding)}</p>
            )}
            <p className="text-[11px] text-muted-foreground mt-1">{branchName(branchId === "all" ? null : branchId)}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Remitted (last 50 payments)</p>
            <p className="font-display text-xl font-semibold tabular-nums mt-0.5">
              {fmtMoney(
                (remittancesQ.data ?? [])
                  .filter((r) => !r.is_voided)
                  .reduce((s, r) => s + Number(r.amount), 0),
              )}
            </p>
          </div>
        </div>

        {remittancesQ.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : (remittancesQ.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No VAT payments recorded yet.</p>
        ) : (
          <div className="rounded-lg border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead>Paid from</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(remittancesQ.data ?? []).map((r) => (
                  <TableRow key={r.id} className={r.is_voided ? "opacity-60" : undefined}>
                    <TableCell className="whitespace-nowrap">{r.payment_date}</TableCell>
                    <TableCell>{branchName(r.branch_id)}</TableCell>
                    <TableCell className="text-xs">{accountName(r.payment_account_id)}</TableCell>
                    <TableCell className="text-xs">{r.reference ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtMoney(Number(r.amount))}</TableCell>
                    <TableCell className="text-right">
                      {r.is_voided ? (
                        <Badge variant="outline">Voided</Badge>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => voidMutation.mutate(r.id)}
                          disabled={voidMutation.isPending}
                        >
                          <RotateCcw className="h-3.5 w-3.5 mr-1" />
                          Void
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Record VAT payment</DialogTitle>
            <DialogDescription>
              Outstanding VAT payable: {fmtMoney(outstanding)}
              {branchId !== "all" ? ` · ${branchName(branchId)}` : ""}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Payment date</Label>
                <Input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Amount</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Paid from (cash / bank)</Label>
              <AccountSelect
                value={paymentAccountId}
                onValueChange={setPaymentAccountId}
                accounts={cashAndBankAccounts}
                placeholder="Select the paying account"
              />
            </div>

            <div className="space-y-1.5">
              <Label>SADAD / reference number</Label>
              <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional" />
            </div>

            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </div>

            {Number(amount) > outstanding + 0.01 && (
              <Alert variant="destructive">
                <AlertDescription>
                  This payment is larger than the outstanding VAT payable balance of {fmtMoney(outstanding)}.
                </AlertDescription>
              </Alert>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => postMutation.mutate()} disabled={!canSubmit}>
              {postMutation.isPending ? "Posting…" : "Record & post to ledger"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
