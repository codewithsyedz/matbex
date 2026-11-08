import { useMemo, useState } from "react";
import { format, differenceInCalendarDays, parseISO } from "date-fns";
import { Banknote, CreditCard, Download, RotateCcw, Timer, Wallet } from "lucide-react";
import { toast } from "sonner";
import {
  parseReversalLinkageError,
  formatReversalLinkageToast,
  type ReversalLinkageError,
} from "@/lib/reversalLinkageError";
import { ReversalLinkageErrorAlert } from "@/components/accounting/ReversalLinkageErrorAlert";
import { ReversalStatusNotice } from "@/components/accounting/ReversalStatusNotice";
import { evaluateReversalEligibility, formatReversalBlockToast } from "@/lib/reversalGuard";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useCurrency } from "@/hooks/useCurrency";
import { useCardSettlementClearing } from "@/hooks/useCardSettlementClearing";
import { CardSettlementSetupGuide } from "@/components/accounting/CardSettlementSetupGuide";

export default function CardSettlementClearing() {
  const { tenant } = useAuth();
  const { branches, activeBranchId, pinnedBranchId } = useBranch();
  const { format: fmt } = useCurrency();

  const [branchId, setBranchId] = useState<string>(pinnedBranchId ?? activeBranchId ?? "all");
  const { clearingAccount, bankAccounts, balance, deposits, isLoading, postDeposit, reverseDeposit } =
    useCardSettlementClearing({ branchId });

  const [depositOpen, setDepositOpen] = useState(false);
  const [depositDate, setDepositDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [gross, setGross] = useState("");
  const [fee, setFee] = useState("0");
  const [bankAccountId, setBankAccountId] = useState<string>("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [periodFrom, setPeriodFrom] = useState("");
  const [periodTo, setPeriodTo] = useState("");

  const [reverseId, setReverseId] = useState<string | null>(null);
  const [reverseReason, setReverseReason] = useState("");
  const [reverseError, setReverseError] = useState<ReversalLinkageError | null>(null);

  /** Live reversal eligibility of the deposit selected in the reverse dialog. */
  const reverseStatus = useMemo(() => {
    if (!reverseId) return null;
    const d = deposits.find((x) => x.id === reverseId);
    return evaluateReversalEligibility({
      posted: !!d,
      originalTransactionId: d?.id ?? null,
      reversed: d?.is_reversed,
      reversedAt: d?.reversed_at,
      label: "payout",
    });
  }, [reverseId, deposits]);

  const branchScopeLabel = useMemo(
    () =>
      !branchId || branchId === "all"
        ? "All branches"
        : branches.find((b) => b.id === branchId)?.name ?? branchId,
    [branchId, branches],
  );

  const grossNum = Number(gross || 0);
  const feeNum = Number(fee || 0);
  const netNum = Math.max(0, grossNum - feeNum);
  const canPost = grossNum > 0 && feeNum >= 0 && feeNum <= grossNum && !!depositDate;

  /** Every deposit gets a traceable reference, auto-generated when left blank. */
  const autoReference = useMemo(
    () => `CSD-${(depositDate || format(new Date(), "yyyy-MM-dd")).replace(/-/g, "")}-${format(new Date(), "HHmmss")}`,
    [depositDate],
  );
  const effectiveReference = reference.trim() || autoReference;

  /** Prefill the dialog with the full open 1015 balance for a one-click clearance. */
  const openSettleFull = () => {
    setGross(balance.outstanding > 0 ? balance.outstanding.toFixed(2) : "");
    setFee("0");
    setDepositDate(format(new Date(), "yyyy-MM-dd"));
    setDepositOpen(true);
  };

  const daysInTransit =
    balance.oldestTakingDate && balance.outstanding > 0.005
      ? differenceInCalendarDays(new Date(), parseISO(balance.oldestTakingDate))
      : 0;

  const resetForm = () => {
    setGross("");
    setFee("0");
    setReference("");
    setNotes("");
    setPeriodFrom("");
    setPeriodTo("");
  };

  const handlePost = async () => {
    try {
      await postDeposit.mutateAsync({
        depositDate,
        grossAmount: grossNum,
        feeAmount: feeNum,
        branchId: branchId === "all" ? null : branchId,
        bankAccountId: bankAccountId || null,
        reference: effectiveReference,
        notes: notes || null,
        periodFrom: periodFrom || null,
        periodTo: periodTo || null,
      });
      toast.success("Deposit posted", {
        description: `${effectiveReference} — DR bank ${fmt(netNum)} / CR 1015 ${fmt(grossNum)}.`,
      });
      setDepositOpen(false);
      resetForm();
    } catch (e: any) {
      toast.error("Could not post deposit", { description: e?.message ?? "Unknown error" });
    }
  };

  const handleReverse = async () => {
    if (!reverseId) return;
    if (reverseStatus && !reverseStatus.allowed) {
      toast.error(reverseStatus.title ?? "Reversal blocked", {
        description: formatReversalBlockToast(reverseStatus),
      });
      return;
    }
    try {
      setReverseError(null);
      await reverseDeposit.mutateAsync({ depositId: reverseId, reason: reverseReason });
      toast.success("Deposit reversed", { description: "A mirrored journal entry was posted." });
      setReverseId(null);
      setReverseReason("");
    } catch (e: any) {
      const parsed = parseReversalLinkageError(e);
      if (parsed) {
        setReverseError(parsed);
        toast.error(parsed.title, { description: formatReversalLinkageToast(parsed) });
        return;
      }
      toast.error("Could not reverse deposit", { description: e?.message ?? "Unknown error" });
    }
  };

  const handleExportCsv = () => {
    const lines: string[] = [];
    lines.push(`Card Settlement Clearing,${tenant?.name ?? ""}`);
    lines.push(`Branch,${branchScopeLabel}`);
    lines.push(`Card takings in clearing,${balance.cardTakings.toFixed(2)}`);
    lines.push(`Settled to bank,${balance.settled.toFixed(2)}`);
    lines.push(`Awaiting payout,${balance.outstanding.toFixed(2)}`);
    lines.push("");
    lines.push(
      ["Deposit date", "Period", "Reference", "Posted at", "Gross", "Fee", "Net to bank", "Status"].join(","),
    );
    for (const d of deposits) {
      lines.push(
        [
          d.deposit_date,
          d.period_from && d.period_to ? `${d.period_from} to ${d.period_to}` : "",
          `"${(d.reference ?? "").replace(/"/g, '""')}"`,
          d.created_at ? format(new Date(d.created_at), "yyyy-MM-dd HH:mm") : "",
          Number(d.gross_amount).toFixed(2),
          Number(d.fee_amount).toFixed(2),
          Number(d.net_amount).toFixed(2),
          d.is_reversed ? "Reversed" : "Posted",
        ].join(","),
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `card-settlement-clearing-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between min-h-[56px]">
          <div className="min-w-[240px] flex-1"><h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight flex items-center gap-2">
            <CreditCard className="h-7 w-7 text-primary" />
            Card Settlement Clearing
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Card takings post to <span className="font-medium">1015 Card Settlements Receivable</span> at day end and
            only move to your bank account when the acquirer payout is recorded here.
          </p>
        </div>
        <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
          <Select value={branchId} onValueChange={setBranchId}>
            <SelectTrigger className="h-9 w-full sm:w-[200px]">
              <SelectValue placeholder="Branch" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All branches</SelectItem>
              {branches.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={handleExportCsv}>
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </Button>
          {balance.outstanding > 0.005 && (
            <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={openSettleFull}>
              <Wallet className="h-3.5 w-3.5" />
              Settle {fmt(balance.outstanding)}
            </Button>
          )}
          <Button size="sm" className="h-9 gap-1.5" onClick={() => setDepositOpen(true)}>
            <Banknote className="h-3.5 w-3.5" />
            Record payout
          </Button>
        </div>
      </header>

      <CardSettlementSetupGuide
        cardTakings={balance.cardTakings}
        payoutCount={deposits.filter((d) => !d.is_reversed).length}
      />

      {!isLoading && !clearingAccount && (
        <Alert variant="destructive">
          <AlertDescription>
            Account <strong>1015 Card Settlements Receivable</strong> is missing, so payouts cannot be recorded yet.
            Use the setup steps above to create it.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Card takings booked", value: balance.cardTakings, icon: CreditCard, hint: "Debits to 1015" },
          { label: "Settled to bank", value: balance.settled, icon: Wallet, hint: "Credits to 1015" },
          { label: "Awaiting payout", value: balance.outstanding, icon: Timer, hint: "Open clearing balance" },
        ].map((k) => (
          <Card key={k.label}>
            <CardHeader className="pb-3">
              <CardDescription className="flex items-center gap-1.5">
                <k.icon className="h-3.5 w-3.5" />
                {k.label}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-7 w-28" />
              ) : (
                <p className="text-2xl font-semibold tabular-nums">{fmt(k.value)}</p>
              )}
              <p className="text-xs text-muted-foreground mt-1">{k.hint}</p>
            </CardContent>
          </Card>
        ))}
        <Card>
          <CardHeader className="pb-3">
            <CardDescription className="flex items-center gap-1.5">
              <Timer className="h-3.5 w-3.5" />
              Oldest in transit
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">
              {balance.outstanding > 0.005 ? `${daysInTransit}d` : "—"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {balance.oldestTakingDate && balance.outstanding > 0.005
                ? `Since ${balance.oldestTakingDate}`
                : "Nothing outstanding"}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">Recorded payouts</CardTitle>
          <CardDescription>
            Each payout posts DR bank (net) + DR 6620 Bank Charges (fee) / CR 1015 (gross).
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : deposits.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              No payouts recorded yet for {branchScopeLabel}.
            </p>
          ) : (
            <ScrollArea className="max-h-[520px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Deposit date</TableHead>
                    <TableHead>Covers</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead>Posted at</TableHead>
                    <TableHead className="text-right">Gross</TableHead>
                    <TableHead className="text-right">Fee</TableHead>
                    <TableHead className="text-right">Net to bank</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {deposits.map((d) => (
                    <TableRow key={d.id} className={d.is_reversed ? "opacity-60" : undefined}>
                      <TableCell className="whitespace-nowrap">{d.deposit_date}</TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {d.period_from && d.period_to ? `${d.period_from} → ${d.period_to}` : "—"}
                      </TableCell>
                      <TableCell className="max-w-[220px] truncate">{d.reference ?? "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {d.created_at ? format(new Date(d.created_at), "yyyy-MM-dd HH:mm") : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{fmt(Number(d.gross_amount))}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmt(Number(d.fee_amount))}</TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {fmt(Number(d.net_amount))}
                      </TableCell>
                      <TableCell>
                        {d.is_reversed ? (
                          <Badge variant="secondary">Reversed</Badge>
                        ) : (
                          <Badge variant="outline">Posted</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {!d.is_reversed && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="gap-1.5"
                            onClick={() => setReverseId(d.id)}
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            Reverse
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Record payout */}
      <Dialog open={depositOpen} onOpenChange={setDepositOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Record acquirer payout</DialogTitle>
            <DialogDescription>
              Enter the gross card takings being settled and the fee the acquirer deducted.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Deposit date</Label>
                <Input type="date" value={depositDate} onChange={(e) => setDepositDate(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Bank account</Label>
                <Select value={bankAccountId} onValueChange={setBankAccountId}>
                  <SelectTrigger>
                    <SelectValue placeholder="1010 Bank Account – Primary" />
                  </SelectTrigger>
                  <SelectContent>
                    {bankAccounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.account_code} · {a.account_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Covers sales from</Label>
                <Input type="date" value={periodFrom} onChange={(e) => setPeriodFrom(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Covers sales to</Label>
                <Input type="date" value={periodTo} onChange={(e) => setPeriodTo(e.target.value)} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Gross card amount</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  value={gross}
                  onChange={(e) => setGross(e.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-2">
                <Label>Acquirer fee</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  value={fee}
                  onChange={(e) => setFee(e.target.value)}
                  placeholder="0.00"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Bank reference</Label>
              <Input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="Payout / statement reference"
              />
              <p className="text-xs text-muted-foreground">
                Leave blank to auto-generate <span className="font-mono">{autoReference}</span>.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-[70px]" />
            </div>

            <div className="rounded-lg border p-3 text-sm space-y-1">
              <p className="font-medium">Ledger preview</p>
              <p className="text-muted-foreground">DR Bank — {fmt(netNum)}</p>
              {feeNum > 0 && <p className="text-muted-foreground">DR 6620 Bank Charges — {fmt(feeNum)}</p>}
              <p className="text-muted-foreground">CR 1015 Card Settlements Receivable — {fmt(grossNum)}</p>
              <p className="text-xs text-muted-foreground pt-1 border-t mt-2">
                Posted as <span className="font-mono">{effectiveReference}</span> on {depositDate}, stamped with the
                time it was recorded.
              </p>
              {feeNum > grossNum && (
                <p className="text-destructive">Fee cannot exceed the gross amount.</p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDepositOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handlePost} disabled={!canPost || postDeposit.isPending}>
              {postDeposit.isPending ? "Posting…" : "Post deposit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reverse */}
      <Dialog
        open={!!reverseId}
        onOpenChange={(o) => {
          if (!o) {
            setReverseId(null);
            setReverseError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reverse this payout</DialogTitle>
            <DialogDescription>
              A mirrored journal entry is posted — the original stays in the ledger for audit.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Reason</Label>
            <Textarea
              value={reverseReason}
              onChange={(e) => setReverseReason(e.target.value)}
              placeholder="e.g. Payout amount corrected by the acquirer"
              className="min-h-[80px]"
            />
          </div>
          <ReversalLinkageErrorAlert error={reverseError} />
          <ReversalStatusNotice status={reverseStatus} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setReverseId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleReverse}
              disabled={
                reverseReason.trim().length < 3 ||
                reverseDeposit.isPending ||
                !!(reverseStatus && !reverseStatus.allowed)
              }
            >
              {reverseDeposit.isPending ? "Reversing…" : "Post reversal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
