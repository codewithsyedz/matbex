import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { format } from "date-fns";
import { useBranchShiftSummary, type BranchShiftRow } from "@/hooks/useBranchComparison";
import { useBranch } from "@/contexts/BranchContext";
import { useCurrency } from "@/hooks/useCurrency";

interface Props {
  startDate: Date;
  endDate: Date;
}

export function BranchShiftSummaryReport({ startDate, endDate }: Props) {
  const { format: formatCurrency } = useCurrency();
  const { activeBranchId, isAllBranches } = useBranch();
  const { data: rows = [], isLoading } = useBranchShiftSummary(startDate, endDate);

  const filtered = useMemo(
    () =>
      isAllBranches || !activeBranchId
        ? rows
        : rows.filter((r) => r.branch_id === activeBranchId),
    [rows, activeBranchId, isAllBranches],
  );

  // Group by branch for per-branch subtotals
  const grouped = useMemo(() => {
    const map = new Map<string, { name: string; shifts: BranchShiftRow[] }>();
    filtered.forEach((r) => {
      const key = r.branch_id || "unassigned";
      if (!map.has(key)) map.set(key, { name: r.branch_name, shifts: [] });
      map.get(key)!.shifts.push(r);
    });
    return Array.from(map.entries()).map(([id, v]) => {
      const closed = v.shifts.filter((s) => s.status === "closed");
      const totalVariance = closed.reduce(
        (sum, s) => sum + Math.abs(Number(s.variance || 0)),
        0,
      );
      const perfect = closed.filter((s) => Math.abs(Number(s.variance || 0)) < 1).length;
      return { id, name: v.name, shifts: v.shifts, closed, totalVariance, perfect };
    });
  }, [filtered]);

  if (isLoading) {
    return <Skeleton className="h-96 w-full" />;
  }

  if (filtered.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6 text-center text-muted-foreground">
          No shifts in this date range for the selected branch.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {grouped.map((g) => (
        <Card key={g.id}>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle className="text-base font-medium">{g.name}</CardTitle>
              <div className="flex items-center gap-2 text-xs">
                <Badge variant="outline">{g.shifts.length} shifts</Badge>
                <Badge variant="outline">{g.closed.length} closed</Badge>
                <Badge variant="outline" className="text-success">
                  {g.perfect} perfect
                </Badge>
                <Badge variant="outline">
                  Variance: ±{formatCurrency(g.totalVariance)}
                </Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <ScrollArea className="w-full">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Opened</TableHead>
                    <TableHead>Closed</TableHead>
                    <TableHead>Cashier</TableHead>
                    <TableHead className="text-right">Opening Float</TableHead>
                    <TableHead className="text-right">Expected</TableHead>
                    <TableHead className="text-right">Counted</TableHead>
                    <TableHead className="text-right">Variance</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {g.shifts.map((s) => {
                    const v = Number(s.variance ?? 0);
                    const abs = Math.abs(v);
                    const tone =
                      s.status !== "closed"
                        ? "text-muted-foreground"
                        : abs < 1
                        ? "text-success"
                        : abs < 10
                        ? ""
                        : abs < 50
                        ? "text-warning"
                        : "text-destructive";
                    return (
                      <TableRow key={s.shift_id}>
                        <TableCell className="text-xs">
                          {format(new Date(s.opened_at), "MMM d, HH:mm")}
                        </TableCell>
                        <TableCell className="text-xs">
                          {s.closed_at
                            ? format(new Date(s.closed_at), "MMM d, HH:mm")
                            : "-"}
                        </TableCell>
                        <TableCell>{s.cashier_name}</TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(Number(s.opening_float ?? 0))}
                        </TableCell>
                        <TableCell className="text-right">
                          {s.expected_cash != null
                            ? formatCurrency(Number(s.expected_cash))
                            : "-"}
                        </TableCell>
                        <TableCell className="text-right">
                          {s.counted_cash != null
                            ? formatCurrency(Number(s.counted_cash))
                            : "-"}
                        </TableCell>
                        <TableCell className={`text-right font-medium ${tone}`}>
                          {s.status === "closed"
                            ? `${v >= 0 ? "+" : ""}${formatCurrency(v)}`
                            : "-"}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              s.status === "closed"
                                ? "secondary"
                                : s.status === "open"
                                ? "default"
                                : "outline"
                            }
                            className="capitalize"
                          >
                            {s.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <ScrollBar orientation="horizontal" />
            </ScrollArea>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
