import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import type { EmployeeFine } from "@/hooks/useEmployeeFines";
import { buildFineInstallmentSchedule } from "@/lib/fineInstallments";

interface Props {
  fines: EmployeeFine[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone?: () => void;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const nextMonth = (month: string) => {
  const [y, m] = month.slice(0, 7).split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
};

/**
 * Bulk version of the single-fine conversion: splits every selected fine into
 * its own installment schedule, using the per-fine already deducted amount and
 * the employee's monthly deduction limit. Each conversion is executed through
 * the same RPC, so audit entries are written per fine.
 */
export function BulkSplitFinesIntoInstallmentsDialog({ fines, open, onOpenChange, onDone }: Props) {
  const { format: fmt } = useCurrency();
  const queryClient = useQueryClient();
  const [deducted, setDeducted] = useState<Record<string, string>>({});
  const [limits, setLimits] = useState<Record<string, string>>({});
  const [step, setStep] = useState<"details" | "preview">("details");
  const [saving, setSaving] = useState(false);
  const [results, setResults] = useState<Record<string, string>>({});

  const capacityQueries = useQueries({
    queries: fines.map((f) => ({
      queryKey: ["fine-capacity", f.staff_id, f.payroll_month, f.id],
      enabled: open && !!f.staff_id && !!f.payroll_month,
      queryFn: async () => {
        const { data, error } = await supabase.rpc("get_employee_fine_capacity", {
          p_staff_id: f.staff_id,
          p_payroll_month: f.payroll_month,
          p_exclude_fine_id: f.id,
        });
        if (error) throw error;
        return data as unknown as { monthly_fine_limit: number };
      },
    })),
  });

  const capacityKey = capacityQueries.map((q) => q.data?.monthly_fine_limit ?? "").join("|");

  useEffect(() => {
    if (!open) return;
    setStep("details");
    setResults({});
    setDeducted(
      Object.fromEntries(fines.map((f) => [f.id, String(Number(f.recovered_amount ?? 0))])),
    );
  }, [open, fines.map((f) => f.id).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    setLimits((prev) => {
      const next = { ...prev };
      fines.forEach((f, i) => {
        const l = capacityQueries[i]?.data?.monthly_fine_limit;
        if (l != null && next[f.id] === undefined) next[f.id] = String(Number(l));
      });
      return next;
    });
  }, [open, capacityKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const plans = useMemo(
    () =>
      fines.map((f) => {
        const total = Number(f.amount ?? 0);
        const recovered = round2(Number(f.recovered_amount ?? 0));
        const unsettled = round2(total - recovered);
        const raw = deducted[f.id] ?? "0";
        const already = round2(Number(raw) || 0);
        const monthlyLimit = Math.max(0, Number(limits[f.id] ?? "0") || 0);
        const remaining = round2(total - already);
        const startMonth = nextMonth(f.payroll_month);
        const error = isNaN(Number(raw))
          ? "Enter a valid number."
          : already < 0
          ? "Already deducted cannot be negative."
          : already > unsettled
          ? `Cannot exceed the unsettled balance of ${fmt(unsettled)}.`
          : null;
        const schedule =
          error || remaining <= 0
            ? []
            : buildFineInstallmentSchedule({
                totalAmount: remaining,
                startMonth,
                firstMonthCapacity: monthlyLimit,
                monthlyLimit,
              });
        return { fine: f, total, already, monthlyLimit, remaining, startMonth, error, schedule };
      }),
    [fines, deducted, limits, fmt],
  );

  const invalid = plans.some((p) => p.error);
  const totalInstallments = plans.reduce((s, p) => s + p.schedule.length, 0);
  const totalScheduled = round2(plans.reduce((s, p) => s + Math.max(0, p.remaining), 0));

  const submit = async () => {
    if (invalid) return;
    setSaving(true);
    const outcome: Record<string, string> = {};
    let ok = 0;
    for (const p of plans) {
      const { error } = await supabase.rpc("convert_fine_to_installments", {
        p_fine_id: p.fine.id,
        p_already_deducted: p.already,
        p_monthly_limit: p.monthlyLimit || null,
        p_start_month: p.startMonth,
      });
      if (error) outcome[p.fine.id] = error.message;
      else ok += 1;
    }
    setResults(outcome);
    setSaving(false);
    queryClient.invalidateQueries({ queryKey: ["employee-fines"] });
    queryClient.invalidateQueries({ queryKey: ["fine-capacity"] });
    queryClient.invalidateQueries({ queryKey: ["payroll-approved-fines"] });
    queryClient.invalidateQueries({ queryKey: ["fine-settlement-groups"] });
    const failed = Object.keys(outcome).length;
    if (failed === 0) {
      toast.success(`${ok} fine${ok > 1 ? "s" : ""} split into ${totalInstallments} installments`);
      onDone?.();
      onOpenChange(false);
    } else {
      toast.error(`${failed} of ${plans.length} could not be split`, {
        description: "Review the errors listed per fine and retry.",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Split {fines.length} fines into installments</DialogTitle>
          <DialogDescription>
            {step === "details"
              ? "Step 1 of 2 — Set what was already deducted and the monthly limit for each fine."
              : "Step 2 of 2 — Review every schedule before confirming."}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] pr-3">
          <div className="grid gap-3">
            <div className="rounded-md border border-border/60 p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Fines selected</span>
                <span className="font-medium">{fines.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total to schedule</span>
                <span className="font-medium">{fmt(Math.max(0, totalScheduled))}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Installments to create</span>
                <span className="font-medium">{totalInstallments}</span>
              </div>
            </div>

            {plans.map((p) => (
              <div key={p.fine.id} className="rounded-md border border-border/60 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm">
                    <span className="font-mono text-xs text-muted-foreground">
                      {p.fine.fine_number ?? "—"}
                    </span>
                    <span className="ml-2 font-medium">{p.fine.staff?.name ?? "—"}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground">{fmt(p.total)}</span>
                    <Badge variant="secondary" className="text-[10px]">
                      {p.schedule.length
                        ? `${p.schedule.length} installment${p.schedule.length > 1 ? "s" : ""}`
                        : "Fully recovered"}
                    </Badge>
                  </div>
                </div>

                {step === "details" ? (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div className="grid gap-1.5">
                      <Label className="text-xs">Already deducted</Label>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={deducted[p.fine.id] ?? "0"}
                        aria-invalid={!!p.error}
                        onChange={(e) =>
                          setDeducted((d) => ({ ...d, [p.fine.id]: e.target.value }))
                        }
                      />
                      {p.error && <p className="text-xs text-destructive">{p.error}</p>}
                    </div>
                    <div className="grid gap-1.5">
                      <Label className="text-xs">Monthly deduction limit</Label>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={limits[p.fine.id] ?? ""}
                        onChange={(e) => setLimits((l) => ({ ...l, [p.fine.id]: e.target.value }))}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 text-xs">
                    {p.schedule.length === 0 ? (
                      <p className="text-muted-foreground">
                        Nothing left to recover — will be marked as fully deducted.
                      </p>
                    ) : (
                      <table className="w-full">
                        <thead className="text-muted-foreground">
                          <tr className="border-b border-border/60">
                            <th className="py-1 text-left font-normal">#</th>
                            <th className="py-1 text-left font-normal">Payroll month</th>
                            <th className="py-1 text-right font-normal">Deduction</th>
                          </tr>
                        </thead>
                        <tbody>
                          {p.schedule.map((s, i) => (
                            <tr key={s.installment_number} className="border-b border-border/40 last:border-0">
                              <td className="py-1 text-muted-foreground">
                                {i + 1}/{p.schedule.length}
                              </td>
                              <td className="py-1">{s.payroll_month.slice(0, 7)}</td>
                              <td className="py-1 text-right font-medium">{fmt(s.amount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}

                {results[p.fine.id] && (
                  <p className="mt-2 text-xs text-destructive">{results[p.fine.id]}</p>
                )}
              </div>
            ))}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => (step === "preview" ? setStep("details") : onOpenChange(false))}
          >
            Back
          </Button>
          {step === "details" ? (
            <Button onClick={() => setStep("preview")} disabled={invalid || fines.length === 0}>
              Preview schedules
            </Button>
          ) : (
            <Button onClick={submit} disabled={saving || invalid}>
              {saving ? "Splitting…" : `Confirm ${totalInstallments} installments`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
