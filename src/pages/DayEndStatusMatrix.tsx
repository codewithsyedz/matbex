import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { addMonths, eachDayOfInterval, endOfMonth, format, isAfter, startOfMonth, subMonths } from "date-fns";
import { CalendarClock, ChevronLeft, ChevronRight, Download, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

import { useBranch } from "@/contexts/BranchContext";
import { useCurrency } from "@/hooks/useCurrency";
import {
  useDayEndStatusMatrix,
  DAY_END_STATUS_LABEL,
  type DayEndStatus,
} from "@/hooks/useDayEndStatusMatrix";

const statusTone: Record<DayEndStatus, string> = {
  open: "bg-muted text-muted-foreground border-border",
  draft: "bg-blue-50 text-blue-700 border-blue-200",
  closed: "bg-emerald-50 text-emerald-700 border-emerald-200",
  partially_reversed: "bg-amber-50 text-amber-700 border-amber-200",
  reversed: "bg-rose-50 text-rose-700 border-rose-200",
  reopened: "bg-purple-50 text-purple-700 border-purple-200",
};

const statusShort: Record<DayEndStatus, string> = {
  open: "—",
  draft: "Draft",
  closed: "Closed",
  partially_reversed: "Partial",
  reversed: "Reversed",
  reopened: "Reopened",
};

export default function DayEndStatusMatrix() {
  const { branches, pinnedBranchId, canSwitchBranches } = useBranch();
  const { format: fmt } = useCurrency();
  const [month, setMonth] = useState<Date>(startOfMonth(new Date()));

  const visibleBranches = useMemo(() => {
    const list = (branches ?? []).filter((b: any) => !b.deleted_at);
    if (!canSwitchBranches && pinnedBranchId) return list.filter((b: any) => b.id === pinnedBranchId);
    return list;
  }, [branches, canSwitchBranches, pinnedBranchId]);

  const branchIds = useMemo(() => visibleBranches.map((b: any) => b.id), [visibleBranches]);
  const { cells, isLoading, refetch } = useDayEndStatusMatrix({ month, branchIds });

  const days = useMemo(() => {
    const today = new Date();
    const end = endOfMonth(month);
    return eachDayOfInterval({ start: startOfMonth(month), end: isAfter(end, today) ? today : end });
  }, [month]);

  const cellFor = (date: Date, branchId: string) =>
    cells[`${format(date, "yyyy-MM-dd")}|${branchId}`];

  const summary = useMemo(() => {
    const counts: Record<DayEndStatus, number> = {
      open: 0, draft: 0, closed: 0, partially_reversed: 0, reversed: 0, reopened: 0,
    };
    days.forEach((d) => {
      branchIds.forEach((bid) => {
        counts[cellFor(d, bid)?.status ?? "open"] += 1;
      });
    });
    return counts;
  }, [days, branchIds, cells]);

  const exportCsv = () => {
    if (days.length === 0 || branchIds.length === 0) {
      toast.error("Nothing to export");
      return;
    }
    const header = ["Date", "Branch", "Status", "Total sales", "Ledger posted", "Voided lines", "Reversed adjustments", "Overhead status"];
    const rows: string[] = [];
    days.forEach((d) => {
      visibleBranches.forEach((b: any) => {
        const c = cellFor(d, b.id);
        rows.push(
          [
            format(d, "yyyy-MM-dd"),
            b.name,
            DAY_END_STATUS_LABEL[c?.status ?? "open"],
            c?.totalSales != null ? c.totalSales.toFixed(2) : "",
            c?.ledgerPosted ? "Yes" : "No",
            c?.voidedLines ?? 0,
            c?.reversedAdjustments ?? 0,
            c?.overheadStatus ?? "",
          ]
            .map((v) => `"${String(v).replace(/"/g, '""')}"`)
            .join(","),
        );
      });
    });
    const blob = new Blob([[header.join(","), ...rows].join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `day-end-status-${format(month, "yyyy-MM")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 min-h-[56px]">
          <div className="min-w-[240px] flex-1"><h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight flex items-center gap-2">
            <CalendarClock className="h-5 w-5 text-primary" />
            Day-End Status Matrix
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            See at a glance which business days are closed, reopened, or partially reversed per branch.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => setMonth((m) => subMonths(m, 1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[9rem] text-center text-sm font-medium">{format(month, "MMMM yyyy")}</span>
          <Button
            variant="outline"
            size="icon"
            disabled={isAfter(addMonths(month, 1), startOfMonth(new Date()))}
            onClick={() => setMonth((m) => addMonths(m, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
            <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            Live
          </Badge>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" /> Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={exportCsv}>
            <Download className="h-4 w-4 mr-2" /> CSV
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {(Object.keys(DAY_END_STATUS_LABEL) as DayEndStatus[]).map((s) => (
          <Badge key={s} variant="outline" className={statusTone[s]}>
            {DAY_END_STATUS_LABEL[s]} · {summary[s]}
          </Badge>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">{format(month, "MMMM yyyy")} · {visibleBranches.length} branch(es)</CardTitle>
          <CardDescription>Click any cell to open the reversal & reopening audit for that day and branch.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
            </div>
          ) : visibleBranches.length === 0 ? (
            <p className="text-sm text-muted-foreground">No branches available.</p>
          ) : (
            <TooltipProvider delayDuration={150}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-separate border-spacing-y-1">
                  <thead>
                    <tr>
                      <th className="text-left font-medium text-muted-foreground px-2 sticky left-0 bg-background">Date</th>
                      {visibleBranches.map((b: any) => (
                        <th key={b.id} className="text-left font-medium text-muted-foreground px-2 whitespace-nowrap">
                          {b.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {days.map((d) => (
                      <tr key={d.toISOString()}>
                        <td className="px-2 whitespace-nowrap font-medium sticky left-0 bg-background">
                          {format(d, "EEE dd MMM")}
                        </td>
                        {visibleBranches.map((b: any) => {
                          const c = cellFor(d, b.id);
                          const status = c?.status ?? "open";
                          return (
                            <td key={b.id} className="px-2">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Link
                                    to={`/reports/reversal-audit?date=${format(d, "yyyy-MM-dd")}&branch=${b.id}`}
                                    className={`block rounded-md border px-2 py-1 text-xs transition-opacity hover:opacity-80 ${statusTone[status]}`}
                                  >
                                    {statusShort[status]}
                                  </Link>
                                </TooltipTrigger>
                                <TooltipContent className="text-xs space-y-1">
                                  <p className="font-medium">{DAY_END_STATUS_LABEL[status]}</p>
                                  <p>Sales: {c?.totalSales != null ? fmt(c.totalSales) : "not recorded"}</p>
                                  <p>Ledger posted: {c?.ledgerPosted ? "yes" : "no"}</p>
                                  <p>Voided ledger lines: {c?.voidedLines ?? 0}</p>
                                  <p>Reversed adjustments: {c?.reversedAdjustments ?? 0}</p>
                                  {c?.overheadStatus && <p>Overhead: {c.overheadStatus}</p>}
                                </TooltipContent>
                              </Tooltip>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </TooltipProvider>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
