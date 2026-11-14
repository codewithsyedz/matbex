import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useCurrency } from "@/hooks/useCurrency";
import { filterStaffActiveInPeriod, isCurrentPeriod } from "@/lib/staffUtils";
import { BranchBadge } from "@/components/branch/BranchBadge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Calculator, CheckCircle2, MinusCircle } from "lucide-react";

interface Props {
  fiscalStart: Date;
  fiscalEnd: Date;
  totalDays: number;
  /** Total shown on the card, used to prove the formula reconciles. */
  cardTotal: number;
}

interface Line {
  id: string;
  label: string;
  detail: string;
  amount: number;
  included: boolean;
}

/**
 * Interactive proof of the Monthly Overhead figure:
 *   Fixed cost  = sum(active overhead_allocation) - sum(items settled in overhead_payments this month)
 *   Payroll     = sum(salary - pending advances) for branch staff with no payroll_records row this month
 *   Total       = Fixed cost + Payroll
 * Every allocation, payment and staff line is listed as included or excluded.
 */
export function OverheadFormulaBreakdown({ fiscalStart, fiscalEnd, totalDays, cardTotal }: Props) {
  const { restaurant } = useAuth();
  const { branches, activeBranchId, pinnedBranchId } = useBranch();
  const { format: formatCurrency } = useCurrency();

  // Mirror useOverheadData's branch scope exactly.
  const branchId = pinnedBranchId ?? (activeBranchId && activeBranchId !== "__all__" ? activeBranchId : null);
  const branchFilter = branchId ? `branch_id.eq.${branchId},branch_id.is.null` : null;
  const branchName = branches.find((b) => b.id === branchId)?.name ?? null;

  const fiscalStartStr = format(fiscalStart, "yyyy-MM-dd");
  const fiscalEndStr = format(fiscalEnd, "yyyy-MM-dd");

  const { data, isLoading } = useQuery({
    queryKey: ["overhead-formula-breakdown", restaurant?.id, branchId, fiscalStartStr],
    enabled: !!restaurant?.id,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const rid = restaurant!.id;

      const [allocRes, payRes, staffRes, payrollRes, advancesRes] = await Promise.all([
        (async () => {
          let q = db
            .from("overhead_allocation")
            .select("id, name, monthly_amount, branch_id")
            .eq("restaurant_id", rid)
            .eq("is_active", true);
          if (branchFilter) q = q.or(branchFilter);
          return await q.order("monthly_amount", { ascending: false });
        })(),
        (async () => {
          let q = db
            .from("overhead_payments")
            .select("overhead_allocation_id, amount_paid, payment_date, payment_method, branch_id")
            .eq("restaurant_id", rid)
            .eq("payment_month", fiscalStartStr);
          if (branchFilter) q = q.or(branchFilter);
          return await q;
        })(),
        (async () => {
          let q = db
            .from("staff")
            .select("id, name, monthly_salary, hourly_rate, payment_type, joined_date, termination_date, is_active, assigned_branch_id")
            .eq("restaurant_id", rid);
          if (branchId) q = q.eq("assigned_branch_id", branchId);
          if (isCurrentPeriod(fiscalEnd)) q = q.eq("is_active", true);
          return await q;
        })(),
        db
          .from("payroll_records")
          .select("staff_id, amount")
          .eq("restaurant_id", rid)
          .eq("period_start", fiscalStartStr)
          .eq("period_end", fiscalEndStr),
        db
          .from("staff_advances")
          .select("staff_id, amount")
          .eq("restaurant_id", rid)
          .eq("status", "pending"),
      ]);

      if (allocRes.error) throw allocRes.error;
      if (payRes.error) throw payRes.error;
      if (staffRes.error) throw staffRes.error;
      if (payrollRes.error) throw payrollRes.error;
      if (advancesRes.error) throw advancesRes.error;

      const paymentMap = new Map<string, any>();
      (payRes.data || []).forEach((p: any) => paymentMap.set(p.overhead_allocation_id, p));

      const overheadLines: Line[] = (allocRes.data || []).map((item: any) => {
        const payment = paymentMap.get(item.id);
        const amount = Number(item.monthly_amount) || 0;
        return {
          id: item.id,
          label: item.name,
          detail: payment
            ? `Settled ${formatCurrency(Number(payment.amount_paid) || 0)}${payment.payment_date ? ` on ${format(new Date(payment.payment_date), "dd MMM")}` : ""}${payment.payment_method ? ` · ${payment.payment_method}` : ""}`
            : item.branch_id
              ? "Branch-specific · unpaid this month"
              : "Shared (tenant-wide) · unpaid this month",
          amount,
          included: !payment,
        };
      });

      const allStaff = isCurrentPeriod(fiscalEnd)
        ? staffRes.data || []
        : filterStaffActiveInPeriod(staffRes.data || [], fiscalStart, fiscalEnd);
      const staffIds = new Set(allStaff.map((s: any) => s.id));

      const paidStaff = new Map<string, number>();
      (payrollRes.data || [])
        .filter((pr: any) => staffIds.has(pr.staff_id))
        .forEach((pr: any) => paidStaff.set(pr.staff_id, Number(pr.amount) || 0));

      const advanceByStaff = new Map<string, number>();
      (advancesRes.data || [])
        .filter((a: any) => staffIds.has(a.staff_id))
        .forEach((a: any) =>
          advanceByStaff.set(a.staff_id, (advanceByStaff.get(a.staff_id) || 0) + (Number(a.amount) || 0)),
        );

      const payrollLines: Line[] = allStaff.map((s: any) => {
        const salary = Number(s.monthly_salary) || Number(s.hourly_rate) * 160 || 0;
        const advances = advanceByStaff.get(s.id) || 0;
        const alreadyPaid = paidStaff.has(s.id);
        return {
          id: s.id,
          label: s.name,
          detail: alreadyPaid
            ? `Payroll already recorded ${formatCurrency(paidStaff.get(s.id) || 0)} for this period`
            : `Salary ${formatCurrency(salary)}${advances > 0 ? ` − advances ${formatCurrency(advances)}` : ""}`,
          amount: alreadyPaid ? salary : Math.max(0, salary - advances),
          included: !alreadyPaid,
        };
      });

      return { overheadLines, payrollLines };
    },
  });

  const totals = useMemo(() => {
    const o = data?.overheadLines ?? [];
    const p = data?.payrollLines ?? [];
    const fixed = o.filter((l) => l.included).reduce((s, l) => s + l.amount, 0);
    const excludedFixed = o.filter((l) => !l.included).reduce((s, l) => s + l.amount, 0);
    const payroll = p.filter((l) => l.included).reduce((s, l) => s + l.amount, 0);
    const excludedPayroll = p.filter((l) => !l.included).reduce((s, l) => s + l.amount, 0);
    return { fixed, excludedFixed, payroll, excludedPayroll, total: fixed + payroll };
  }, [data]);

  const diff = totals.total - cardTotal;

  const renderSection = (title: string, lines: Line[], included: boolean) => {
    const subset = lines.filter((l) => l.included === included);
    if (subset.length === 0) return null;
    return (
      <div className="space-y-1">
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          {included ? <CheckCircle2 className="h-3.5 w-3.5 text-primary" /> : <MinusCircle className="h-3.5 w-3.5" />}
          {title}
        </p>
        {subset.map((l) => (
          <div
            key={l.id}
            className={`flex items-start justify-between gap-3 rounded-md border px-3 py-2 text-xs ${included ? "" : "opacity-60"}`}
          >
            <div className="min-w-0">
              <p className="truncate font-medium">{l.label}</p>
              <p className="truncate text-[11px] text-muted-foreground">{l.detail}</p>
            </div>
            <span className={`shrink-0 font-medium ${included ? "" : "line-through"}`}>
              {formatCurrency(l.amount)}
            </span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button className="mt-2 flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground">
          <Calculator className="h-3 w-3" />
          Verify fixed cost formula
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Overhead breakdown
            {branchId ? <BranchBadge name={branchName} branchId={branchId} size="sm" /> : <Badge variant="outline">All branches</Badge>}
          </DialogTitle>
          <DialogDescription>
            {format(fiscalStart, "dd MMM yyyy")} – {format(fiscalEnd, "dd MMM yyyy")} · {totalDays} days.
            Fixed cost = active overhead allocations minus items settled in overhead payments. Payroll =
            salary minus pending advances for staff with no payroll record this period.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : (
          <ScrollArea className="max-h-[60vh] pr-3">
            <div className="space-y-5">
              <div className="space-y-3">
                <p className="text-sm font-medium">Fixed overhead</p>
                {renderSection("Included (unpaid this month)", data?.overheadLines ?? [], true)}
                {renderSection("Excluded (already paid)", data?.overheadLines ?? [], false)}
              </div>

              <Separator />

              <div className="space-y-3">
                <p className="text-sm font-medium">Payroll</p>
                {renderSection("Included (still payable)", data?.payrollLines ?? [], true)}
                {renderSection("Excluded (payroll already recorded)", data?.payrollLines ?? [], false)}
                {(data?.payrollLines?.length ?? 0) === 0 && (
                  <p className="text-xs text-muted-foreground">No staff in this branch scope for the period.</p>
                )}
              </div>

              <Separator />

              <div className="space-y-1.5 rounded-lg border bg-muted/30 p-3 text-xs">
                <div className="flex justify-between"><span className="text-muted-foreground">Fixed cost (included)</span><span className="font-medium">{formatCurrency(totals.fixed)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Payroll (included)</span><span className="font-medium">{formatCurrency(totals.payroll)}</span></div>
                <div className="flex justify-between text-muted-foreground"><span>Excluded as paid (overhead + payroll)</span><span>{formatCurrency(totals.excludedFixed + totals.excludedPayroll)}</span></div>
                <Separator className="my-1" />
                <div className="flex justify-between text-sm"><span className="font-medium">Monthly overhead</span><span className="font-semibold">{formatCurrency(totals.total)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Per day ÷ {totalDays}</span><span>{formatCurrency(totalDays > 0 ? totals.total / totalDays : 0)}</span></div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Matches card total {formatCurrency(cardTotal)}</span>
                  <Badge variant={Math.abs(diff) < 0.01 ? "outline" : "destructive"}>
                    {Math.abs(diff) < 0.01 ? "Reconciled" : `Off by ${formatCurrency(diff)}`}
                  </Badge>
                </div>
              </div>
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
