import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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

interface GroupRow {
  id: string;
  amount: number;
  recovered_amount: number | null;
  status: string;
  payroll_month: string;
  installment_number: number | null;
  installment_total_amount: number | null;
  applied_payroll_id: string | null;
  deleted_at: string | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const nextMonthISO = () => {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
};

/**
 * Re-runs the installment split on an existing schedule. Installments already
 * recovered or applied to payroll stay untouched; only the unpaid remainder is
 * re-planned. Prior audit entries are never removed — a new audit row is added.
 */
export function RescheduleFineInstallmentsDialog({ fine, onOpenChange }: Props) {
  const { format: fmt } = useCurrency();
  const queryClient = useQueryClient();
  const groupId = fine?.installment_group_id ?? null;
  const { data: capacity } = useFineCapacity(fine?.staff_id ?? null, fine?.payroll_month, fine?.id);

  const [limit, setLimit] = useState("0");
  const [startMonth, setStartMonth] = useState(nextMonthISO().slice(0, 7));
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState<"details" | "preview">("details");

  const { data: rowsData, isLoading } = useQuery({
    queryKey: ["fine-installment-group", groupId],
    enabled: !!groupId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employee_fines")
        .select(
          "id, amount, recovered_amount, status, payroll_month, installment_number, installment_total_amount, applied_payroll_id, deleted_at",
        )
        .eq("installment_group_id", groupId!)
        .is("deleted_at", null)
        .order("installment_number", { ascending: true });
      if (error) throw error;
      return (data ?? []) as GroupRow[];
    },
  });

  useEffect(() => {
    if (!fine) return;
    setStep("details");
    setReason("");
    setStartMonth(nextMonthISO().slice(0, 7));
  }, [fine]);

  useEffect(() => {
    if (capacity?.monthly_fine_limit) setLimit(String(Number(capacity.monthly_fine_limit)));
  }, [capacity?.monthly_fine_limit]);

  const summary = useMemo(() => {
    const rows = (rowsData ?? []).filter((r) => r.status !== "cancelled");
    const planTotal = round2(
      Math.max(
        ...[
          0,
          ...rows.map((r) => Number(r.installment_total_amount ?? 0)),
          rows.reduce((s, r) => s + Number(r.amount ?? 0), 0),
        ],
      ),
    );
    const settledRows = rows.filter(
      (r) =>
        r.status === "applied" ||
        !!r.applied_payroll_id ||
        Number(r.recovered_amount ?? 0) > 0,
    );
    const settled = round2(
      settledRows.reduce(
        (s, r) =>
          s +
          Math.max(
            Number(r.recovered_amount ?? 0),
            r.status === "applied" || r.applied_payroll_id ? Number(r.amount ?? 0) : 0,
          ),
        0,
      ),
    );
    const pending = rows.filter((r) => !settledRows.includes(r));
    return {
      planTotal,
      settled,
      kept: settledRows.length,
      pendingCount: pending.length,
      pendingAmount: round2(pending.reduce((s, r) => s + Number(r.amount ?? 0), 0)),
      remaining: round2(planTotal - settled),
    };
  }, [rowsData]);

  const monthlyLimit = Math.max(0, Number(limit) || 0);
  const startISO = `${startMonth}-01`;

  const limitError =
    isNaN(Number(limit)) || Number(limit) < 0
      ? "Monthly limit must be zero or a positive number."
      : null;
  const monthError = /^\d{4}-\d{2}$/.test(startMonth) ? null : "Choose a valid start month.";
  const invalid = !!limitError || !!monthError || summary.remaining <= 0;

  const preview =
    invalid || !fine
      ? []
      : buildFineInstallmentSchedule({
          totalAmount: summary.remaining,
          startMonth: startISO,
          firstMonthCapacity: monthlyLimit,
          monthlyLimit,
        });

  const previewRows = preview.map((s, i) => {
    const paid = preview.slice(0, i + 1).reduce((sum, r) => sum + r.amount, 0);
    return { ...s, display_number: i + 1, balance_after: round2(summary.remaining - paid) };
  });

  const submit = async () => {
    if (!fine || invalid) return;
    setSaving(true);
    const { error } = await supabase.rpc("reschedule_fine_installments", {
      p_fine_id: fine.id,
      p_monthly_limit: monthlyLimit || null,
      p_start_month: startISO,
      p_reason: reason.trim() || null,
    });
    setSaving(false);
    if (error) {
      toast.error("Could not re-plan the installments", { description: error.message });
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["employee-fines"] });
    queryClient.invalidateQueries({ queryKey: ["fine-capacity"] });
    queryClient.invalidateQueries({ queryKey: ["payroll-approved-fines"] });
    queryClient.invalidateQueries({ queryKey: ["fine-installment-group"] });
    queryClient.invalidateQueries({ queryKey: ["fine-audit"] });
    toast.success(
      `Remaining ${fmt(summary.remaining)} re-planned into ${preview.length} installment${
        preview.length > 1 ? "s" : ""
      }`,
    );
    onOpenChange(false);
  };

  return (
    <Dialog open={!!fine} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Re-plan installments — {fine?.fine_number ?? ""}</DialogTitle>
          <DialogDescription>
            {step === "details"
              ? "Step 1 of 2 — Only the unpaid balance is rescheduled. Deducted installments and all audit history stay intact."
              : "Step 2 of 2 — Review the new monthly schedule before confirming."}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] pr-3">
          <div className="grid gap-4">
            <div className="rounded-md border border-border/60 p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Plan total</span>
                <span className="font-medium">{fmt(summary.planTotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Already deducted ({summary.kept} kept)</span>
                <span className="font-medium">{fmt(summary.settled)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  Unpaid installments to replace ({summary.pendingCount})
                </span>
                <span className="font-medium">{fmt(summary.pendingAmount)}</span>
              </div>
              <div className="flex justify-between border-t border-border/60 pt-2 mt-2">
                <span className="text-muted-foreground">Remaining to re-plan</span>
                <span className="font-medium">{fmt(Math.max(0, summary.remaining))}</span>
              </div>
            </div>

            {isLoading && (
              <p className="text-xs text-muted-foreground">Loading the current schedule…</p>
            )}

            {!isLoading && summary.remaining <= 0 && (
              <p className="text-xs text-muted-foreground">
                Nothing left to re-plan — this fine is already fully recovered.
              </p>
            )}

            {step === "details" && (
              <>
                <div className="grid gap-2">
                  <Label>Monthly deduction limit</Label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={limit}
                    onChange={(e) => setLimit(e.target.value)}
                    aria-invalid={!!limitError}
                  />
                  {limitError && <p className="text-xs text-destructive">{limitError}</p>}
                </div>
                <div className="grid gap-2">
                  <Label>First payroll month</Label>
                  <Input
                    type="month"
                    value={startMonth}
                    onChange={(e) => setStartMonth(e.target.value)}
                    aria-invalid={!!monthError}
                  />
                  {monthError && <p className="text-xs text-destructive">{monthError}</p>}
                </div>
                <div className="grid gap-2">
                  <Label>Reason (recorded in the audit trail)</Label>
                  <Textarea
                    rows={2}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="e.g. Employee requested smaller monthly deductions"
                  />
                </div>
              </>
            )}

            {step === "preview" && previewRows.length > 0 && (
              <div className="rounded-md border border-border/60">
                <div className="border-b border-border/60 px-3 py-2 text-xs font-medium">
                  {previewRows.length} new installment{previewRows.length > 1 ? "s" : ""} ·{" "}
                  {fmt(summary.remaining)} from {startMonth} · max {fmt(monthlyLimit)}/month
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
                    {previewRows.map((s) => (
                      <tr key={s.payroll_month} className="border-b border-border/40 last:border-0">
                        <td className="px-3 py-1.5 text-muted-foreground">
                          {s.display_number}/{previewRows.length}
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
                  <span>{fmt(previewRows.reduce((s, r) => s + r.amount, 0))}</span>
                </div>
              </div>
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
          {step === "details" ? (
            <Button
              onClick={() => setStep("preview")}
              disabled={invalid || preview.length === 0 || isLoading}
            >
              Preview new schedule
            </Button>
          ) : (
            <Button onClick={submit} disabled={saving || invalid}>
              {saving ? "Re-planning…" : "Confirm re-plan"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
