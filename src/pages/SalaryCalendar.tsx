import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, subMonths } from "date-fns";
import { CalendarClock, Download, CheckCircle2, Send, BookOpenCheck } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useCurrency } from "@/hooks/useCurrency";
import { useFiscalSettings } from "@/hooks/useFiscalSettings";
import { LockedFeatureScreen } from "@/components/LockedFeatureScreen";
import { AutoPostPayrollDialog } from "@/components/staff/AutoPostPayrollDialog";
import { AdvanceBalanceTracker } from "@/components/staff/AdvanceBalanceTracker";
import { Link } from "react-router-dom";
import {
  buildSalaryCalendar,
  buildSalaryCalendarCsv,
  buildBranchSalaryCalendarCsv,
  buildSalaryCycles,
  groupSalaryCalendarByBranch,
  PAYROLL_MONTH_DAYS,
  type SalaryCalendarStaff,
} from "@/lib/salaryCalendar";

const HORIZONS = [6, 12, 18] as const;

export default function SalaryCalendar() {
  const { restaurant, user, hasFeature, loading: authLoading } = useAuth();
  const { branches, activeBranchId, pinnedBranchId } = useBranch();
  const { format: fmt } = useCurrency();
  const { settings, isLoading: fiscalLoading } = useFiscalSettings() as any;

  const [branchId, setBranchId] = useState<string>(pinnedBranchId ?? activeBranchId ?? "all");
  const [months, setMonths] = useState<number>(12);
  const [startFrom, setStartFrom] = useState<"current" | "previous">("current");
  const [autoPostOpen, setAutoPostOpen] = useState(false);

  const monthStartDay = settings?.month_start_day ?? 1;
  const payrollCutoffDay = settings?.payroll_cutoff_day ?? 1;

  const cycles = useMemo(() => {
    const anchor = startFrom === "previous" ? subMonths(new Date(), 1) : new Date();
    return buildSalaryCycles(anchor, monthStartDay, months, payrollCutoffDay);
  }, [monthStartDay, months, payrollCutoffDay, startFrom]);

  const rangeStart = cycles[0]?.start;
  const rangeEnd = cycles[cycles.length - 1]?.end;

  const { data: staffList = [], isLoading: staffLoading } = useQuery({
    queryKey: ["salary-calendar-staff", restaurant?.id, branchId],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      const { db } = await import("@/integrations/db/client");
      let q = db
        .from("staff")
        .select(
          "id, name, role, payment_type, monthly_salary, assigned_branch_id, joined_date, termination_date"
        )
        .eq("restaurant_id", restaurant.id)
        .eq("payment_type", "monthly");
      if (branchId && branchId !== "all") q = q.eq("assigned_branch_id", branchId);
      const { data, error } = await q.order("name");
      if (error) throw error;
      return (data ?? []) as SalaryCalendarStaff[];
    },
    enabled: !!restaurant?.id,
  });

  const { data: paidRecords = [], isLoading: payrollLoading } = useQuery({
    queryKey: [
      "salary-calendar-payroll",
      restaurant?.id,
      rangeStart ? format(rangeStart, "yyyy-MM-dd") : null,
      rangeEnd ? format(rangeEnd, "yyyy-MM-dd") : null,
    ],
    queryFn: async () => {
      if (!restaurant?.id || !rangeStart || !rangeEnd) return [];
      const { db } = await import("@/integrations/db/client");
      const { data, error } = await db
        .from("payroll_records")
        .select("id, staff_id, amount, period_start, period_end, payment_date")
        .eq("restaurant_id", restaurant.id)
        .gte("period_end", format(rangeStart, "yyyy-MM-dd"))
        .lte("period_end", format(rangeEnd, "yyyy-MM-dd"));
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!restaurant?.id && !!rangeStart && !!rangeEnd,
  });

  const paidByStaff = useMemo(() => {
    const map: Record<string, Set<string>> = {};
    for (const rec of paidRecords as any[]) {
      const key = String(rec.period_end).slice(0, 7);
      (map[rec.staff_id] ??= new Set<string>()).add(key);
    }
    return map;
  }, [paidRecords]);

  const rows = useMemo(
    () => buildSalaryCalendar(staffList, cycles, paidByStaff),
    [staffList, cycles, paidByStaff]
  );

  const staffNames = useMemo(
    () => Object.fromEntries(staffList.map((s) => [s.id, s.name])) as Record<string, string>,
    [staffList]
  );

  const branchNames = useMemo(
    () => Object.fromEntries(branches.map((b) => [b.id, b.name])) as Record<string, string>,
    [branches]
  );

  const groups = useMemo(
    () => groupSalaryCalendarByBranch(rows, cycles, branchNames),
    [rows, cycles, branchNames]
  );

  const columnTotals = useMemo(
    () => cycles.map((_, i) => rows.reduce((sum, r) => sum + (r.cells[i]?.amount ?? 0), 0)),
    [rows, cycles]
  );
  const grandTotal = columnTotals.reduce((a, b) => a + b, 0);
  const nextCycle = cycles[0];
  const nextCycleTotal = columnTotals[0] ?? 0;

  const branchLabel =
    !branchId || branchId === "all"
      ? "All branches"
      : branches.find((b) => b.id === branchId)?.name ?? branchId;

  const isLoading = staffLoading || payrollLoading || fiscalLoading;
  const splitByBranch = !branchId || branchId === "all";
  const colSpan = cycles.length + 2;

  const handleExport = () => {
    const csv = splitByBranch
      ? buildBranchSalaryCalendarCsv(groups, cycles)
      : buildSalaryCalendarCsv(rows, cycles);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const slug = splitByBranch ? "all-branches" : branchLabel.toLowerCase().replace(/\s+/g, "-");
    a.download = `salary-calendar-${slug}-${format(new Date(), "yyyyMMdd")}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success("Salary calendar exported");
  };


  if (!authLoading && !hasFeature("payroll")) {
    return (
      <LockedFeatureScreen
        featureName="Salary Calendar"
        description="Plan monthly salary liabilities per employee, with prorated amounts and payment dates."
        featureKey="payroll"
      />
    );
  }

  return (
    <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between min-h-[56px]">
        <div className="min-w-[240px] flex-1">
          <h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight flex items-center gap-2">
            <CalendarClock className="h-7 w-7 text-primary" />
            Salary Calendar
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Month-by-month prorated salary per employee and when each cycle becomes payable ·{" "}
            {branchLabel} · {PAYROLL_MONTH_DAYS}-day basis
          </p>
        </div>

        <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
          <Select value={branchId} onValueChange={setBranchId}>
            <SelectTrigger className="h-9 w-[180px]">
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

          <Select value={startFrom} onValueChange={(v) => setStartFrom(v as "current" | "previous")}>
            <SelectTrigger className="h-9 w-[170px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="current">From current cycle</SelectItem>
              <SelectItem value="previous">Include last cycle</SelectItem>
            </SelectContent>
          </Select>

          <Select value={String(months)} onValueChange={(v) => setMonths(Number(v))}>
            <SelectTrigger className="h-9 w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HORIZONS.map((h) => (
                <SelectItem key={h} value={String(h)}>
                  {h} months
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            size="sm"
            className="h-9 gap-1.5"
            onClick={() => setAutoPostOpen(true)}
            disabled={isLoading || rows.length === 0}
          >
            <Send className="h-3.5 w-3.5" />
            Auto-post {nextCycle?.label ?? "cycle"}
          </Button>

          <Button variant="outline" size="sm" className="h-9 gap-1.5" asChild>
            <Link to="/staff/payroll-journal">
              <BookOpenCheck className="h-3.5 w-3.5" />
              Payroll Journal
            </Link>
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5"
            onClick={handleExport}
            disabled={isLoading || rows.length === 0}
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </Button>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Employees on payroll", value: String(rows.length) },
          {
            label: nextCycle ? `${nextCycle.label} payroll` : "Next payroll",
            value: fmt(nextCycleTotal),
          },
          {
            label: "Next payment date",
            value: nextCycle ? format(nextCycle.paymentDate, "dd MMM yyyy") : "—",
          },
          { label: `Total over ${months} months`, value: fmt(grandTotal) },
        ].map((k) => (
          <Card key={k.label}>
            <CardContent className="pt-6">
              <p className="text-xs text-muted-foreground">{k.label}</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{k.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {splitByBranch && !isLoading && groups.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-medium">Branch breakdown</CardTitle>
            <CardDescription>
              Each branch's prorated salary liability for {nextCycle?.label ?? "the next cycle"} and
              across the full {months}-month horizon.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {groups.map((group) => (
              <button
                key={group.branchId}
                type="button"
                onClick={() =>
                  group.branchId !== "unassigned" && setBranchId(group.branchId)
                }
                className="rounded-lg border bg-card p-4 text-left transition-colors hover:bg-accent/40"
              >
                <p className="text-sm font-medium">{group.branchName}</p>
                <p className="text-xs text-muted-foreground">
                  {group.rows.length} employee{group.rows.length === 1 ? "" : "s"}
                </p>
                <div className="mt-3 flex items-baseline justify-between gap-2">
                  <span className="text-xs text-muted-foreground">
                    {nextCycle?.label ?? "Next"}
                  </span>
                  <span className="text-base font-semibold tabular-nums">
                    {fmt(group.cycleTotals[0] ?? 0)}
                  </span>
                </div>
                <div className="mt-1 flex items-baseline justify-between gap-2">
                  <span className="text-xs text-muted-foreground">{months}-month total</span>
                  <span className="text-sm tabular-nums">{fmt(group.total)}</span>
                </div>
              </button>
            ))}
          </CardContent>
        </Card>
      )}



      <AdvanceBalanceTracker
        restaurantId={restaurant?.id}
        branchId={branchId}
        staffNames={staffNames}
        nextCycleLabel={nextCycle?.label}
        nextPaymentDate={nextCycle?.paymentDate}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">Monthly salary plan</CardTitle>
          <CardDescription>
            Amounts are prorated on a fixed 30-day month for joiners and leavers. Cycles already
            paid are marked.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No monthly-salaried staff found for this branch.
            </p>
          ) : (
            <TooltipProvider>
              <ScrollArea className="w-full">
                <div className="min-w-max">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="sticky left-0 bg-background z-10 min-w-[180px]">
                          Employee
                        </TableHead>
                        {cycles.map((c) => (
                          <TableHead key={c.key} className="text-right min-w-[120px]">
                            <div className="font-medium">{c.label}</div>
                            <div className="text-[11px] font-normal text-muted-foreground">
                              pay {format(c.paymentDate, "dd MMM")}
                            </div>
                          </TableHead>
                        ))}
                        <TableHead className="text-right min-w-[110px]">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {groups.map((group) => (
                        <Fragment key={group.branchId}>
                          {splitByBranch && (
                            <TableRow key={`${group.branchId}-head`} className="bg-muted/60">
                              <TableCell
                                colSpan={colSpan}
                                className="sticky left-0 z-10 bg-muted/60 text-xs font-semibold uppercase tracking-wide"
                              >
                                {group.branchName} · {group.rows.length} employee
                                {group.rows.length === 1 ? "" : "s"}
                              </TableCell>
                            </TableRow>
                          )}
                          {group.rows.map((row) => (
                            <TableRow key={row.staff.id}>
                              <TableCell className="sticky left-0 bg-background z-10">
                                <div className="font-medium">{row.staff.name}</div>
                                <div className="text-xs text-muted-foreground capitalize">
                                  {row.staff.role}
                                </div>
                              </TableCell>
                              {row.cells.map((cell) => (
                                <TableCell key={cell.cycleKey} className="text-right tabular-nums">
                                  {cell.amount === 0 ? (
                                    <span className="text-muted-foreground">—</span>
                                  ) : (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <span className="inline-flex items-center gap-1">
                                          {cell.isPaid && (
                                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                                          )}
                                          <span className={cell.isProrated ? "text-amber-600" : ""}>
                                            {fmt(cell.amount)}
                                          </span>
                                        </span>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        <p className="text-xs">
                                          {cell.payableDays}/{PAYROLL_MONTH_DAYS} days ·{" "}
                                          {cell.isProrated
                                            ? `prorated (${cell.reason ?? "partial"})`
                                            : "full month"}
                                          {cell.isPaid ? " · paid" : ""}
                                        </p>
                                      </TooltipContent>
                                    </Tooltip>
                                  )}
                                </TableCell>
                              ))}
                              <TableCell className="text-right font-medium tabular-nums">
                                {fmt(row.total)}
                              </TableCell>
                            </TableRow>
                          ))}
                          {splitByBranch && (
                            <TableRow key={`${group.branchId}-subtotal`} className="bg-muted/20">
                              <TableCell className="sticky left-0 z-10 bg-muted/20 text-sm font-medium">
                                {group.branchName} subtotal
                              </TableCell>
                              {group.cycleTotals.map((t, i) => (
                                <TableCell
                                  key={cycles[i].key}
                                  className="text-right font-medium tabular-nums"
                                >
                                  {fmt(t)}
                                </TableCell>
                              ))}
                              <TableCell className="text-right font-semibold tabular-nums">
                                {fmt(group.total)}
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      ))}

                      <TableRow className="bg-muted/40">
                        <TableCell className="sticky left-0 bg-muted/40 z-10 font-medium">
                          Total
                        </TableCell>
                        {columnTotals.map((t, i) => (
                          <TableCell key={cycles[i].key} className="text-right font-medium tabular-nums">
                            {fmt(t)}
                          </TableCell>
                        ))}
                        <TableCell className="text-right font-semibold tabular-nums">
                          {fmt(grandTotal)}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
                <ScrollBar orientation="horizontal" />
              </ScrollArea>
            </TooltipProvider>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Badge variant="outline" className="gap-1">
          <CheckCircle2 className="h-3 w-3 text-emerald-600" /> Already paid
        </Badge>
        <Badge variant="outline" className="text-amber-600">
          Prorated (joining / leaving)
        </Badge>
      </div>

      <AutoPostPayrollDialog
        open={autoPostOpen}
        onOpenChange={setAutoPostOpen}
        cycle={nextCycle}
        rows={rows}
        cycleIndex={0}
        restaurantId={restaurant?.id}
        userId={user?.id}
      />
    </div>
  );
}
