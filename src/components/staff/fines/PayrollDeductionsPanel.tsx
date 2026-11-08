import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { useCurrency } from "@/hooks/useCurrency";
import { useFineCapacity } from "@/hooks/useEmployeeFines";
import { useFiscalSettings } from "@/hooks/useFiscalSettings";

interface Props {
  staffId: string;
  periodStart: string;
  periodEnd: string;
  grossWage: number;
  otherDeductions: number;
  advanceRecovered: number;
}

/**
 * Employee Deductions block rendered inside the payroll dialog.
 * Lists every approved fine that will be pulled into this payroll run and
 * enforces the configured maximum wage-deduction percentage before saving.
 */
export function PayrollDeductionsPanel({
  staffId,
  periodStart,
  periodEnd,
  grossWage,
  otherDeductions,
  advanceRecovered,
}: Props) {
  const { format: fmt } = useCurrency();
  const { data: capacity } = useFineCapacity(staffId || null, periodStart || undefined);
  const { fineAllocationMode } = useFiscalSettings();
  const byCreated = fineAllocationMode === "created_date";

  const { data: fines = [] } = useQuery({
    queryKey: ["payroll-approved-fines", staffId, periodStart, periodEnd, fineAllocationMode],
    queryFn: async () => {
      let q = supabase
        .from("employee_fines")
        .select(
          "id, fine_number, amount, status, installment_number, installment_count, payroll_month, created_at, violation_type:violation_type_id(name_en)",
        )
        .eq("staff_id", staffId)
        .eq("status", "approved")
        .is("deleted_at", null);

      q = byCreated
        // Include arrears: any approved installment due on or before this period end
        // is recovered in this run until the full fine is settled.
        ? q.lte("created_at", `${periodEnd}T23:59:59`).order("created_at", { ascending: true })
        : q.lte("payroll_month", periodEnd).order("payroll_month", { ascending: true });

      const { data, error } = await q;
      if (error) throw error;
      return data as unknown as {
        id: string;
        fine_number: string | null;
        amount: number;
        installment_number: number | null;
        installment_count: number | null;
        payroll_month: string | null;
        created_at: string;
        violation_type: { name_en: string } | null;
      }[];
    },
    enabled: !!staffId && !!periodStart && !!periodEnd,
  });

  const fineTotal = fines.reduce((s, f) => s + Number(f.amount), 0);
  const total = fineTotal + Number(otherDeductions || 0) + Number(advanceRecovered || 0);
  const pct = Number(capacity?.max_total_deduction_pct ?? 50);
  const maxAllowed = grossWage > 0 ? Math.round(grossWage * (pct / 100) * 100) / 100 : 0;
  const excess = Math.max(total - maxAllowed, 0);

  if (!staffId) return null;

  const monthLabel = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleDateString(undefined, { month: "short", year: "numeric" })
      : "Unscheduled";

  // Group each fine/instalment under the payroll month it is allocated to,
  // resolved by the configured recovery basis.
  const groups = fines.reduce<Record<string, typeof fines>>((acc, f) => {
    const key = monthLabel(byCreated ? f.created_at : f.payroll_month);
    (acc[key] ||= []).push(f);
    return acc;
  }, {});

  return (
    <div className="space-y-2 rounded-lg border border-border/60 bg-muted/30 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">Employee deductions</p>
        <Badge variant="outline" className="text-[10px]">
          Recovery basis: {byCreated ? "Fine creation date" : "Instalment date"}
        </Badge>
      </div>

      <div className="space-y-1">
        {Object.entries(groups).map(([month, items]) => (
          <div key={month} className="space-y-1">
            <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-muted-foreground">
              <span>Allocated to {month}</span>
              <span>{fmt(items.reduce((s, f) => s + Number(f.amount), 0))}</span>
            </div>
            {items.map((f) => (
              <div key={f.id} className="flex items-center justify-between pl-2 text-xs">
                <span className="flex flex-wrap items-center gap-2">
                  {f.violation_type?.name_en ?? "Fine"}
                  <Badge variant="outline" className="font-mono text-[10px]">{f.fine_number}</Badge>
                  {(f.installment_count ?? 1) > 1 && (
                    <Badge variant="secondary" className="text-[10px]">
                      Instalment {f.installment_number} of {f.installment_count}
                    </Badge>
                  )}
                </span>
                <span className="font-medium">{fmt(Number(f.amount))}</span>
              </div>
            ))}
          </div>
        ))}
        {advanceRecovered > 0 && (
          <div className="flex items-center justify-between text-xs">
            <span>Salary advance recovery</span>
            <span className="font-medium">{fmt(advanceRecovered)}</span>
          </div>
        )}
        {otherDeductions > 0 && (
          <div className="flex items-center justify-between text-xs">
            <span>Other deductions</span>
            <span className="font-medium">{fmt(otherDeductions)}</span>
          </div>
        )}
        {fines.length === 0 && otherDeductions <= 0 && advanceRecovered <= 0 && (
          <p className="text-xs text-muted-foreground">No deductions for this period.</p>
        )}
      </div>

      <div className="flex items-center justify-between border-t pt-1.5 text-xs">
        <span className="text-muted-foreground">Total deductions</span>
        <span className="font-semibold">{fmt(total)}</span>
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Maximum permitted ({pct}% of due wage)</span>
        <span className="font-medium">{fmt(maxAllowed)}</span>
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Remaining capacity</span>
        <span className="font-medium text-primary">{fmt(Math.max(maxAllowed - total, 0))}</span>
      </div>

      {excess > 0 && (
        <Alert variant="destructive" className="py-2">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle className="text-xs">Deduction limit exceeded</AlertTitle>
          <AlertDescription className="text-xs">
            Requested deductions exceed the permitted maximum by {fmt(excess)}. Payroll cannot be
            finalized until an authorized user adjusts a deduction — amounts are never reduced
            silently.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}