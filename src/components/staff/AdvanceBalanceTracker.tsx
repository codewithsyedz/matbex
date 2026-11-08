import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { ChevronDown, ChevronRight, Wallet } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCurrency } from "@/hooks/useCurrency";

interface AdvanceRow {
  id: string;
  staff_id: string;
  amount: number;
  repaid_amount: number | null;
  advance_date: string;
  status: string;
  reason: string | null;
  branch_id: string | null;
}

interface RepaymentRow {
  id: string;
  advance_id: string;
  amount: number;
  repayment_date: string;
  source: string;
  payroll_id: string | null;
  notes: string | null;
}

export interface AdvanceBalanceTrackerProps {
  restaurantId?: string;
  branchId: string;
  /** Employee id -> display name, from the salary calendar rows. */
  staffNames: Record<string, string>;
  /** Next payroll cycle label / payment date, used to show expected recovery. */
  nextCycleLabel?: string;
  nextPaymentDate?: Date;
}

interface StaffAdvanceSummary {
  staffId: string;
  name: string;
  advanced: number;
  recovered: number;
  outstanding: number;
  openCount: number;
  oldestDate: string | null;
  repayments: RepaymentRow[];
  advances: AdvanceRow[];
}

export function AdvanceBalanceTracker({
  restaurantId,
  branchId,
  staffNames,
  nextCycleLabel,
  nextPaymentDate,
}: AdvanceBalanceTrackerProps) {
  const { format: fmt } = useCurrency();
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["salary-calendar-advances", restaurantId, branchId],
    enabled: !!restaurantId,
    queryFn: async () => {
      const { supabase } = await import("@/integrations/supabase/client");
      let q = supabase
        .from("staff_advances")
        .select("id, staff_id, amount, repaid_amount, advance_date, status, reason, branch_id")
        .eq("restaurant_id", restaurantId!)
        .neq("status", "forgiven")
        .order("advance_date", { ascending: true });
      if (branchId && branchId !== "all") q = q.eq("branch_id", branchId);
      const { data: advances, error } = await q;
      if (error) throw error;

      const ids = (advances ?? []).map((a: any) => a.id);
      let repayments: RepaymentRow[] = [];
      if (ids.length > 0) {
        const { data: reps, error: repErr } = await supabase
          .from("staff_advance_repayments")
          .select("id, advance_id, amount, repayment_date, source, payroll_id, notes")
          .in("advance_id", ids)
          .order("repayment_date", { ascending: false });
        if (repErr) throw repErr;
        repayments = (reps ?? []) as RepaymentRow[];
      }
      return { advances: (advances ?? []) as AdvanceRow[], repayments };
    },
  });

  const summaries = useMemo<StaffAdvanceSummary[]>(() => {
    if (!data) return [];
    const repaymentsByAdvance: Record<string, RepaymentRow[]> = {};
    for (const r of data.repayments) (repaymentsByAdvance[r.advance_id] ??= []).push(r);

    const map: Record<string, StaffAdvanceSummary> = {};
    for (const adv of data.advances) {
      const recovered = Math.min(Number(adv.repaid_amount ?? 0), Number(adv.amount));
      const outstanding = Math.max(Number(adv.amount) - recovered, 0);
      const s = (map[adv.staff_id] ??= {
        staffId: adv.staff_id,
        name: staffNames[adv.staff_id] ?? "Unknown employee",
        advanced: 0,
        recovered: 0,
        outstanding: 0,
        openCount: 0,
        oldestDate: null,
        repayments: [],
        advances: [],
      });
      s.advanced += Number(adv.amount);
      s.recovered += recovered;
      s.outstanding += outstanding;
      s.advances.push(adv);
      s.repayments.push(...(repaymentsByAdvance[adv.id] ?? []));
      if (outstanding > 0) {
        s.openCount += 1;
        if (!s.oldestDate || adv.advance_date < s.oldestDate) s.oldestDate = adv.advance_date;
      }
    }

    return Object.values(map)
      .map((s) => ({
        ...s,
        repayments: s.repayments.sort((a, b) => (a.repayment_date < b.repayment_date ? 1 : -1)),
      }))
      .sort((a, b) => b.outstanding - a.outstanding || a.name.localeCompare(b.name));
  }, [data, staffNames]);

  const totals = useMemo(
    () =>
      summaries.reduce(
        (acc, s) => ({
          advanced: acc.advanced + s.advanced,
          recovered: acc.recovered + s.recovered,
          outstanding: acc.outstanding + s.outstanding,
        }),
        { advanced: 0, recovered: 0, outstanding: 0 }
      ),
    [summaries]
  );

  const withOutstanding = summaries.filter((s) => s.outstanding > 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <Wallet className="h-4 w-4 text-primary" />
          Advance balances
        </CardTitle>
        <CardDescription>
          Outstanding staff advances and how they have been recovered. Remaining balances are
          expected to be recovered from{" "}
          {nextCycleLabel && nextPaymentDate
            ? `${nextCycleLabel} payroll (pay ${format(nextPaymentDate, "dd MMM yyyy")})`
            : "the next payroll cycle"}
          .
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : summaries.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No staff advances recorded for this branch.
          </p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                { label: "Total advanced", value: fmt(totals.advanced) },
                { label: "Recovered to date", value: fmt(totals.recovered) },
                {
                  label: `Outstanding (${withOutstanding.length} employee${
                    withOutstanding.length === 1 ? "" : "s"
                  })`,
                  value: fmt(totals.outstanding),
                },
              ].map((k) => (
                <div key={k.label} className="rounded-lg border bg-card p-3">
                  <p className="text-xs text-muted-foreground">{k.label}</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums">{k.value}</p>
                </div>
              ))}
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[180px]">Employee</TableHead>
                  <TableHead className="text-right">Advanced</TableHead>
                  <TableHead className="text-right">Recovered</TableHead>
                  <TableHead className="text-right">Outstanding</TableHead>
                  <TableHead className="min-w-[160px]">Recovery</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summaries.map((s) => {
                  const open = expanded === s.staffId;
                  return (
                    <Fragment key={s.staffId}>
                      <TableRow
                        className="cursor-pointer"
                        onClick={() => setExpanded(open ? null : s.staffId)}
                      >
                        <TableCell>
                          <div className="flex items-center gap-1.5 font-medium">
                            {open ? (
                              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                            )}
                            {s.name}
                          </div>
                          {s.oldestDate && (
                            <div className="pl-5 text-xs text-muted-foreground">
                              open since {format(parseISO(s.oldestDate), "dd MMM yyyy")}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{fmt(s.advanced)}</TableCell>
                        <TableCell className="text-right tabular-nums text-emerald-600">
                          {fmt(s.recovered)}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {s.outstanding > 0 ? (
                            <span className="text-amber-600">{fmt(s.outstanding)}</span>
                          ) : (
                            fmt(0)
                          )}
                        </TableCell>
                        <TableCell>
                          {s.outstanding > 0 ? (
                            <Badge variant="outline" className="font-normal">
                              {nextPaymentDate
                                ? `Due ${format(nextPaymentDate, "dd MMM yyyy")}`
                                : "Next payroll"}
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="font-normal">
                              Fully recovered
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                      {open && (
                        <TableRow key={`${s.staffId}-detail`} className="bg-muted/30">
                          <TableCell colSpan={5}>
                            <div className="space-y-3 py-1">
                              <div>
                                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                  Advances
                                </p>
                                <ul className="mt-1 space-y-1 text-sm">
                                  {s.advances.map((a) => {
                                    const rec = Math.min(
                                      Number(a.repaid_amount ?? 0),
                                      Number(a.amount)
                                    );
                                    return (
                                      <li
                                        key={a.id}
                                        className="flex flex-wrap items-baseline justify-between gap-2"
                                      >
                                        <span>
                                          {format(parseISO(a.advance_date), "dd MMM yyyy")}
                                          {a.reason ? ` · ${a.reason}` : ""}
                                        </span>
                                        <span className="tabular-nums text-muted-foreground">
                                          {fmt(rec)} of {fmt(Number(a.amount))} recovered
                                        </span>
                                      </li>
                                    );
                                  })}
                                </ul>
                              </div>
                              <div>
                                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                  Recovery history
                                </p>
                                {s.repayments.length === 0 ? (
                                  <p className="mt-1 text-sm text-muted-foreground">
                                    No recoveries recorded yet.
                                  </p>
                                ) : (
                                  <ul className="mt-1 space-y-1 text-sm">
                                    {s.repayments.map((r) => (
                                      <li
                                        key={r.id}
                                        className="flex flex-wrap items-baseline justify-between gap-2"
                                      >
                                        <span>
                                          {format(parseISO(r.repayment_date), "dd MMM yyyy")} ·{" "}
                                          <span className="capitalize">{r.source}</span>
                                          {r.payroll_id ? " (payroll deduction)" : ""}
                                        </span>
                                        <span className="tabular-nums text-emerald-600">
                                          {fmt(Number(r.amount))}
                                        </span>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </>
        )}
      </CardContent>
    </Card>
  );
}
