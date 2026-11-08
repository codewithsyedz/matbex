import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useCurrency } from "@/hooks/useCurrency";
import { useFineCapacity, type EmployeeFine } from "@/hooks/useEmployeeFines";
import { buildFineInstallmentSchedule } from "@/lib/fineInstallments";

interface Props {
  fine: EmployeeFine | null;
  onOpenChange: (open: boolean) => void;
}

const nextMonth = (month: string) => {
  const [y, m] = month.slice(0, 7).split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
};

/**
 * Converts a fine created before the installment feature into an installment
 * schedule. Anything already deducted from previous salaries stays on the
 * original record, and only the remaining balance is spread over next months.
 */
export function ConvertFineToInstallmentsDialog({ fine, onOpenChange }: Props) {
  const { format: fmt } = useCurrency();
  const queryClient = useQueryClient();
  const { data: capacity } = useFineCapacity(fine?.staff_id ?? null, fine?.payroll_month, fine?.id);
  const [deducted, setDeducted] = useState("0");
  const [limit, setLimit] = useState("0");
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState<"details" | "preview">("details");

  useEffect(() => {
    if (!fine) return;
    setDeducted(String(Number(fine.recovered_amount ?? 0)));
    setStep("details");
  }, [fine]);

  useEffect(() => {
    if (capacity?.monthly_fine_limit) setLimit(String(Number(capacity.monthly_fine_limit)));
  }, [capacity?.monthly_fine_limit]);

  const total = Number(fine?.amount ?? 0);
  const recovered = Math.round((Number(fine?.recovered_amount ?? 0)) * 100) / 100;
  const unsettledBalance = Math.round((total - recovered) * 100) / 100;
  const already = Math.round((Number(deducted) || 0) * 100) / 100;
  const monthlyLimit = Math.max(0, Number(limit) || 0);
  const remaining = Math.round((total - already) * 100) / 100;

  const alreadyError = isNaN(Number(deducted))
    ? "Please enter a valid number."
    : already < 0
    ? "Already deducted amount cannot be negative."
    : already > unsettledBalance
    ? `Already deducted amount cannot exceed the current unsettled balance of ${fmt(unsettledBalance)}.`
    : null;

  const invalid = !!alreadyError;

  const startMonth = fine ? nextMonth(fine.payroll_month) : "";
  const preview =
    !fine || invalid || remaining <= 0
      ? []
      : buildFineInstallmentSchedule({
          totalAmount: remaining,
          startMonth,
          firstMonthCapacity: monthlyLimit,
          monthlyLimit,
        });

  // Running balance so each row shows what is still owed after that month.
  const rows = preview.map((s, i) => {
    const paidSoFar = preview.slice(0, i + 1).reduce((sum, r) => sum + r.amount, 0);
    return {
      ...s,
      display_number: s.installment_number + 1,
      balance_after: Math.round((remaining - paidSoFar) * 100) / 100,
    };
  });

  const submit = async () => {
    if (!fine || invalid) return;
    setSaving(true);
    const { error } = await supabase.rpc("convert_fine_to_installments", {
      p_fine_id: fine.id,
      p_already_deducted: already,
      p_monthly_limit: monthlyLimit || null,
      p_start_month: startMonth,
    });
    setSaving(false);
    if (error) {
      toast.error("Could not convert to installments", { description: error.message });
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["employee-fines"] });
    queryClient.invalidateQueries({ queryKey: ["fine-capacity"] });
    queryClient.invalidateQueries({ queryKey: ["payroll-approved-fines"] });
    toast.success(
      remaining <= 0
        ? "Fine marked as fully recovered"
        : `Remaining ${fmt(remaining)} split into ${preview.length} installments`,
    );
    onOpenChange(false);
  };

  return (
    <Dialog open={!!fine} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Split into installments — {fine?.fine_number ?? ""}</DialogTitle>
          <DialogDescription>
            {step === "details"
              ? "Step 1 of 2 — Enter what was already deducted from previous salaries."
              : "Step 2 of 2 — Review the monthly schedule and remaining balance before confirming."}
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh] pr-3">
          <div className="grid gap-4">
            <div className="rounded-md border border-border/60 p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Fine amount</span>
                <span className="font-medium">{fmt(total)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Already deducted</span>
                <span className="font-medium">{fmt(already)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Remaining to schedule</span>
                <span className="font-medium">{fmt(Math.max(0, remaining))}</span>
              </div>
            </div>

            {step === "details" && (
            <>
            <div className="grid gap-2">
              <Label>Already deducted amount</Label>
              <p className="text-xs text-muted-foreground">
                Current unsettled balance: {fmt(unsettledBalance)}.
              </p>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={deducted}
                onChange={(e) => setDeducted(e.target.value)}
                aria-invalid={!!alreadyError}
              />
              {alreadyError && (
                <p className="text-xs text-destructive">{alreadyError}</p>
              )}
            </div>

            <div className="grid gap-2">
              <Label>Monthly deduction limit</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Defaults to the employee's configured monthly fine limit.
              </p>
            </div>
            </>
            )}

            {step === "preview" && rows.length > 0 && (
              <div className="rounded-md border border-border/60">
                <div className="border-b border-border/60 px-3 py-2 text-xs font-medium">
                  {rows.length} installment{rows.length > 1 ? "s" : ""} · {fmt(remaining)} scheduled
                  from {startMonth.slice(0, 7)} · max {fmt(monthlyLimit)}/month
                </div>
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground">
                    <tr className="border-b border-border/60">
                      <th className="px-3 py-1.5 text-left font-normal">#</th>
                      <th className="px-3 py-1.5 text-left font-normal">Payroll month</th>
                      <th className="px-3 py-1.5 text-right font-normal">Deduction</th>
                      <th className="px-3 py-1.5 text-right font-normal">Balance after</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((s) => (
                      <tr key={s.installment_number} className="border-b border-border/40 last:border-0">
                        <td className="px-3 py-1.5 text-muted-foreground">
                          {s.display_number}/{rows.length}
                        </td>
                        <td className="px-3 py-1.5">{s.payroll_month.slice(0, 7)}</td>
                        <td className="px-3 py-1.5 text-right font-medium">{fmt(s.amount)}</td>
                        <td className="px-3 py-1.5 text-right text-muted-foreground">
                          {fmt(Math.max(0, s.balance_after))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="flex justify-between border-t border-border/60 px-3 py-2 text-xs font-medium">
                  <span>Total scheduled</span>
                  <span>{fmt(rows.reduce((sum, r) => sum + r.amount, 0))}</span>
                </div>
              </div>
            )}
            {remaining <= 0 && !invalid && (
              <p className="text-xs text-muted-foreground">
                Nothing left to recover — the fine will be marked as fully deducted.
              </p>
            )}
          </div>
        </ScrollArea>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => (step === "preview" ? setStep("details") : onOpenChange(false))}
          >
            Back
          </Button>
          {step === "details" && remaining > 0 ? (
            <Button onClick={() => setStep("preview")} disabled={invalid || preview.length === 0}>
              Preview schedule
            </Button>
          ) : (
            <Button onClick={submit} disabled={saving || invalid}>
              {remaining <= 0 ? "Mark as recovered" : `Confirm ${preview.length} installments`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}