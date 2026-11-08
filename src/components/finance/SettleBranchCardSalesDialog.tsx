import { useEffect, useState } from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { useCurrency } from "@/hooks/useCurrency";
import { useCardSettlementClearing } from "@/hooks/useCardSettlementClearing";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branchId: string | null;
  branchName: string;
  /** Outstanding gross card takings for this branch in the selected period. */
  unsettled: number;
  periodFrom: Date;
  periodTo: Date;
}

/**
 * Records an acquirer payout for one branch: clears 1015 Card Settlements
 * Receivable into the chosen bank account, with fees expensed.
 */
export function SettleBranchCardSalesDialog({
  open,
  onOpenChange,
  branchId,
  branchName,
  unsettled,
  periodFrom,
  periodTo,
}: Props) {
  const { format: fmt } = useCurrency();
  const qc = useQueryClient();
  const { bankAccounts, postDeposit } = useCardSettlementClearing({ branchId });

  const [depositDate, setDepositDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [gross, setGross] = useState("");
  const [fee, setFee] = useState("0");
  const [bankAccountId, setBankAccountId] = useState<string>("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open) return;
    setDepositDate(format(new Date(), "yyyy-MM-dd"));
    setGross(unsettled > 0 ? unsettled.toFixed(2) : "");
    setFee("0");
    setReference("");
    setNotes("");
  }, [open, unsettled]);

  useEffect(() => {
    if (!bankAccountId && bankAccounts.length) setBankAccountId(bankAccounts[0].id);
  }, [bankAccounts, bankAccountId]);

  const grossNum = Number(gross) || 0;
  const feeNum = Number(fee) || 0;
  const net = Math.max(0, grossNum - feeNum);
  const valid = grossNum > 0 && feeNum >= 0 && feeNum <= grossNum && !!depositDate;

  const handleSubmit = async () => {
    if (!valid) return;
    try {
      await postDeposit.mutateAsync({
        depositDate,
        grossAmount: grossNum,
        feeAmount: feeNum,
        branchId,
        bankAccountId: bankAccountId || null,
        reference: reference.trim() || null,
        notes: notes.trim() || `Card settlement · ${branchName}`,
        periodFrom: format(periodFrom, "yyyy-MM-dd"),
        periodTo: format(periodTo, "yyyy-MM-dd"),
      });
      qc.invalidateQueries({ queryKey: ["card-sales-by-branch"] });
      qc.invalidateQueries({ queryKey: ["branch-ledger-extras"] });
      qc.invalidateQueries({ queryKey: ["profit-loss"] });
      qc.invalidateQueries({ queryKey: ["daily-profit"] });
      toast.success(`Settled ${fmt(grossNum)} for ${branchName}`);
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not record the settlement");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Settle card sales · {branchName}</DialogTitle>
          <DialogDescription>
            Records the acquirer payout and clears card receivables into the bank account.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[70vh] pr-3">
          <div className="space-y-4">
            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Outstanding for period</span>
                <span className="font-semibold tabular-nums">{fmt(unsettled)}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {format(periodFrom, "MMM d, yyyy")} – {format(periodTo, "MMM d, yyyy")}
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="deposit-date">Payout date</Label>
                <Input
                  id="deposit-date"
                  type="date"
                  value={depositDate}
                  onChange={(e) => setDepositDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Bank account</Label>
                <Select value={bankAccountId} onValueChange={setBankAccountId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select account" />
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
              <div className="space-y-1.5">
                <Label htmlFor="gross">Gross payout</Label>
                <Input
                  id="gross"
                  inputMode="decimal"
                  value={gross}
                  onChange={(e) => setGross(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fee">Acquirer fee</Label>
                <Input id="fee" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="reference">Reference</Label>
              <Input
                id="reference"
                placeholder="Bank / acquirer reference"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="notes">Notes</Label>
              <Textarea id="notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>

            <div className="flex items-center justify-between rounded-md border p-3 text-sm">
              <span className="text-muted-foreground">Net to bank</span>
              <span className="font-semibold tabular-nums">{fmt(net)}</span>
            </div>

            {feeNum > grossNum && (
              <p className="text-sm text-destructive">Fee cannot exceed the gross payout.</p>
            )}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!valid || postDeposit.isPending}>
            {postDeposit.isPending ? "Posting…" : "Record settlement"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
