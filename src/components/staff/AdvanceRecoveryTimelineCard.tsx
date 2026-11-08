import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrency } from "@/hooks/useCurrency";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowRight, Banknote, CalendarClock, Wallet } from "lucide-react";

interface Props {
  advanceId: string;
  /** Fallback payroll id stored on the advance (legacy single-deduction flow). */
  deductedFromPayrollId?: string | null;
  onNavigate?: () => void;
}

interface PayrollRun {
  id: string;
  amount: number;
  period_start: string | null;
  period_end: string | null;
  payment_date: string | null;
  advance_recovered: number | null;
  ledger_posted: boolean | null;
}

interface RecoveryRow {
  key: string;
  amount: number;
  date: string | null;
  source: string | null;
  notes: string | null;
  payroll: PayrollRun | null;
}

/**
 * Clickable recovery timeline: every repayment of this advance linked to the
 * exact payroll run that recovered it.
 */
export function AdvanceRecoveryTimelineCard({
  advanceId,
  deductedFromPayrollId,
  onNavigate,
}: Props) {
  const { format: money } = useCurrency();
  const navigate = useNavigate();

  const { data: repayments = [], isLoading: repaymentsLoading } = useQuery({
    queryKey: ["advance-recovery-repayments", advanceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("staff_advance_repayments")
        .select("id, amount, repayment_date, source, notes, payroll_id, created_at")
        .eq("advance_id", advanceId)
        .order("repayment_date", { ascending: true });
      if (error) throw error;
      return (data ?? []) as {
        id: string;
        amount: number;
        repayment_date: string | null;
        source: string | null;
        notes: string | null;
        payroll_id: string | null;
        created_at: string;
      }[];
    },
    enabled: !!advanceId,
  });

  const payrollIds = useMemo(() => {
    const ids = repayments.map((r) => r.payroll_id).filter(Boolean) as string[];
    if (deductedFromPayrollId) ids.push(deductedFromPayrollId);
    return Array.from(new Set(ids));
  }, [repayments, deductedFromPayrollId]);

  const { data: payrolls = [], isLoading: payrollLoading } = useQuery({
    queryKey: ["advance-recovery-payrolls", payrollIds],
    queryFn: async () => {
      if (payrollIds.length === 0) return [];
      const { data, error } = await supabase
        .from("payroll_records")
        .select(
          "id, amount, period_start, period_end, payment_date, advance_recovered, ledger_posted"
        )
        .in("id", payrollIds);
      if (error) throw error;
      return (data ?? []) as PayrollRun[];
    },
    enabled: payrollIds.length > 0,
  });

  const payrollById = useMemo(
    () => new Map(payrolls.map((p) => [p.id, p])),
    [payrolls]
  );

  const rows: RecoveryRow[] = useMemo(() => {
    const list: RecoveryRow[] = repayments.map((r) => ({
      key: r.id,
      amount: Number(r.amount || 0),
      date: r.repayment_date ?? r.created_at,
      source: r.source,
      notes: r.notes,
      payroll: r.payroll_id ? payrollById.get(r.payroll_id) ?? null : null,
    }));

    // Legacy: advance deducted directly on a payroll run without a repayment row
    const covered = new Set(list.map((r) => r.payroll?.id).filter(Boolean));
    if (deductedFromPayrollId && !covered.has(deductedFromPayrollId)) {
      const run = payrollById.get(deductedFromPayrollId);
      if (run) {
        list.push({
          key: `payroll-${run.id}`,
          amount: Number(run.advance_recovered || 0),
          date: run.payment_date ?? run.period_end,
          source: "payroll",
          notes: "Recovered directly on this payroll run",
          payroll: run,
        });
      }
    }

    return list.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }, [repayments, payrollById, deductedFromPayrollId]);

  const openPayroll = (payrollId: string) => {
    onNavigate?.();
    navigate(`/staff?tab=payroll&payroll=${payrollId}`);
  };

  const isLoading = repaymentsLoading || payrollLoading;
  const totalRecovered = rows.reduce((s, r) => s + r.amount, 0);

  return (
    <div className="rounded-md border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-medium">
          <CalendarClock className="h-4 w-4 text-muted-foreground" />
          Recovery timeline
        </p>
        {rows.length > 0 && (
          <Badge variant="outline">
            {rows.length} event{rows.length === 1 ? "" : "s"} · {money(totalRecovered)}
          </Badge>
        )}
      </div>

      {isLoading ? (
        <Skeleton className="mt-3 h-16 w-full" />
      ) : rows.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          No recoveries yet — this advance has not been deducted from a payroll run.
        </p>
      ) : (
        <ol className="mt-3 space-y-3">
          {rows.map((row) => (
            <li key={row.key} className="relative flex gap-3 pl-1">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-green-500/10 text-green-600">
                {row.payroll ? <Wallet className="h-4 w-4" /> : <Banknote className="h-4 w-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium">{money(row.amount)} recovered</p>
                  <Badge variant="secondary" className="text-[10px] capitalize">
                    {row.source ?? "manual"}
                  </Badge>
                  {row.payroll?.ledger_posted && (
                    <Badge variant="outline" className="text-[10px]">
                      Posted
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {row.date ? new Date(row.date).toLocaleDateString() : "—"}
                  {row.payroll && (
                    <>
                      {" · payroll "}
                      {row.payroll.period_start ?? "?"} → {row.payroll.period_end ?? "?"}
                    </>
                  )}
                </p>
                {row.notes && (
                  <p className="mt-0.5 text-xs text-muted-foreground">{row.notes}</p>
                )}
                {row.payroll ? (
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto px-0 text-xs"
                    onClick={() => openPayroll(row.payroll!.id)}
                  >
                    View payroll run ({money(Number(row.payroll.amount || 0))} net)
                    <ArrowRight className="ml-1 h-3 w-3" />
                  </Button>
                ) : (
                  <p className="mt-0.5 text-xs text-amber-600">
                    Not linked to a payroll run (manual repayment)
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}