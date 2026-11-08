import { useEffect, useMemo, useState } from "react";
import { format, addMonths } from "date-fns";
import { AlertTriangle, Scale } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCurrency } from "@/hooks/useCurrency";
import {
  useDeductionAllocation,
  type AllocationDecision,
} from "@/hooks/useDeductionAllocation";

interface Props {
  payrollId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canAllocate: boolean;
  onAllocated?: () => void;
}

/**
 * Shown when total deductions breach the maximum wage-deduction percentage.
 * The user explicitly chooses what to defer — amounts are never silently reduced.
 */
export function DeductionAllocationDialog({
  payrollId,
  open,
  onOpenChange,
  canAllocate,
  onAllocated,
}: Props) {
  const { format: fmt } = useCurrency();
  const { preview, isLoading, applyAllocation } = useDeductionAllocation(open ? payrollId : null);
  const [deferred, setDeferred] = useState<Record<string, boolean>>({});
  const [advance, setAdvance] = useState<string>("");
  const [other, setOther] = useState<string>("");
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (preview) {
      setDeferred({});
      setAdvance(String(preview.advance_recovered ?? 0));
      setOther(String(preview.other_deductions ?? 0));
    }
  }, [preview?.payroll_id]);

  const keptFines = useMemo(
    () => (preview?.fines ?? []).filter((f) => !deferred[f.id]),
    [preview, deferred],
  );
  const keptFineTotal = keptFines.reduce((s, f) => s + Number(f.amount), 0);
  const allocatedTotal =
    keptFineTotal + (parseFloat(advance) || 0) + (parseFloat(other) || 0);
  const remaining = (preview?.max_deduction ?? 0) - allocatedTotal;

  const submit = async () => {
    if (!preview) return;
    if (!reason.trim()) {
      toast.error("A written justification is required");
      return;
    }
    const decisions: AllocationDecision[] = [
      ...preview.fines.map((f) =>
        deferred[f.id]
          ? {
              kind: "fine" as const,
              id: f.id,
              action: "defer" as const,
              defer_to: format(addMonths(new Date(f.payroll_month), 1), "yyyy-MM-dd"),
            }
          : { kind: "fine" as const, id: f.id, action: "keep" as const },
      ),
      { kind: "advance", amount: parseFloat(advance) || 0 },
      { kind: "other", amount: parseFloat(other) || 0 },
    ];
    await applyAllocation.mutateAsync({ decisions, reason });
    onAllocated?.();
    onOpenChange(false);
    setReason("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Scale className="h-4 w-4" /> Deduction limit allocation
          </DialogTitle>
          <DialogDescription>
            Total deductions exceed the permitted share of this wage. Choose what to defer — nothing
            is reduced automatically and every decision is recorded.
          </DialogDescription>
        </DialogHeader>

        {isLoading || !preview ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : (
          <ScrollArea className="max-h-[60vh] pr-3">
            <div className="space-y-4">
              <Alert variant={preview.excess_amount > 0 ? "destructive" : "default"}>
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>
                  Excess {fmt(Number(preview.excess_amount))} over the {preview.max_deduction_pct}% cap
                </AlertTitle>
                <AlertDescription className="text-xs">
                  Gross wage {fmt(Number(preview.gross_wage))} · Maximum deductible{" "}
                  {fmt(Number(preview.max_deduction))} · Requested{" "}
                  {fmt(Number(preview.requested_total))}
                </AlertDescription>
              </Alert>

              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                  Approved fines for this period
                </Label>
                {preview.fines.length === 0 && (
                  <p className="text-sm text-muted-foreground">No approved fines in this period.</p>
                )}
                {preview.fines.map((f) => (
                  <div
                    key={f.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border/60 p-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{f.label}</p>
                      <p className="text-xs text-muted-foreground">
                        Payroll month {format(new Date(f.payroll_month), "MMM yyyy")}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="text-sm font-medium">{fmt(Number(f.amount))}</span>
                      {deferred[f.id] ? (
                        <Badge variant="outline" className="border-transparent bg-amber-500/10 text-amber-600">
                          Deferred to {format(addMonths(new Date(f.payroll_month), 1), "MMM yyyy")}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="border-transparent bg-primary/10 text-primary">
                          Deduct now
                        </Badge>
                      )}
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={!canAllocate}
                        onClick={() => setDeferred((d) => ({ ...d, [f.id]: !d[f.id] }))}
                      >
                        {deferred[f.id] ? "Deduct now" : "Defer"}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              <Separator />

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label>Advance recovery this period</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={advance}
                    disabled={!canAllocate}
                    onChange={(e) => setAdvance(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Requested {fmt(Number(preview.advance_recovered))} — the unrecovered balance stays
                    outstanding.
                  </p>
                </div>
                <div className="grid gap-1.5">
                  <Label>Other deductions</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={other}
                    disabled={!canAllocate}
                    onChange={(e) => setOther(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Requested {fmt(Number(preview.other_deductions))}.
                  </p>
                </div>
              </div>

              <div className="rounded-lg border border-border/60 bg-muted/30 p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span>Allocated this period</span>
                  <span className="font-medium">{fmt(allocatedTotal)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Remaining capacity</span>
                  <span className={remaining < -0.01 ? "font-medium text-destructive" : "font-medium"}>
                    {fmt(remaining)}
                  </span>
                </div>
              </div>

              <div className="grid gap-1.5">
                <Label>Justification (recorded in the audit trail)</Label>
                <Textarea
                  rows={3}
                  value={reason}
                  disabled={!canAllocate}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Why these items were deferred rather than deducted this month"
                />
              </div>

              {!canAllocate && (
                <p className="text-xs text-destructive">
                  Only owners, managers or accountants can allocate deductions.
                </p>
              )}
            </div>
          </ScrollArea>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            onClick={submit}
            disabled={!canAllocate || applyAllocation.isPending || remaining < -0.01 || !reason.trim()}
          >
            Record allocation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
