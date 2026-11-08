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
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { ChartContainer } from "@/components/ui/chart";
import { Building2, Star, AlertTriangle, TrendingUp } from "lucide-react";
import { useBranchComparison, type BranchPerformanceRow } from "@/hooks/useBranchComparison";
import { useCurrency } from "@/hooks/useCurrency";
import { BranchBadge } from "@/components/branch/BranchBadge";

interface Props {
  startDate: Date;
  endDate: Date;
}

const PRIMARY = "hsl(var(--chart-1))";
const SECONDARY = "hsl(var(--chart-3))";
const DANGER = "hsl(var(--chart-5))";

export function BranchComparisonReport({ startDate, endDate }: Props) {
  const { format: formatCurrency } = useCurrency();
  const { data: rows = [], isLoading } = useBranchComparison(startDate, endDate);

  const totals = rows.reduce(
    (acc, r) => {
      acc.netSales += Number(r.net_sales);
      acc.primeCost += Number(r.prime_cost);
      acc.variance += Number(r.cash_variance_total);
      acc.transactions += Number(r.total_transactions);
      return acc;
    },
    { netSales: 0, primeCost: 0, variance: 0, transactions: 0 },
  );

  const chartData = rows.map((r) => ({
    name: r.branch_name,
    sales: Number(r.net_sales),
    primeCost: Number(r.prime_cost),
    variance: Number(r.cash_variance_total),
  }));

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-72 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6 text-center text-muted-foreground">
          <Building2 className="mx-auto h-10 w-10 mb-3 opacity-40" />
          No branches found. Add a branch from Settings → Branches to enable comparison.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPI label="Branches" value={String(rows.length)} icon={<Building2 className="h-4 w-4" />} />
        <KPI label="Total Net Sales" value={formatCurrency(totals.netSales)} icon={<TrendingUp className="h-4 w-4" />} />
        <KPI label="Total Prime Cost" value={formatCurrency(totals.primeCost)} />
        <KPI label="Total Cash Variance" value={`±${formatCurrency(totals.variance)}`} icon={<AlertTriangle className="h-4 w-4" />} />
      </div>

      {/* Chart */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">Sales vs Prime Cost by Branch</CardTitle>
        </CardHeader>
        <CardContent>
          <ChartContainer config={{}} className="h-[320px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="name" className="text-xs fill-muted-foreground" />
                <YAxis className="text-xs fill-muted-foreground" />
                <RTooltip
                  cursor={{ fill: "hsl(var(--muted))", opacity: 0.3 }}
                  contentStyle={{
                    background: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  formatter={(v: number) => formatCurrency(Number(v))}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="sales" name="Net Sales" fill={PRIMARY} radius={[4, 4, 0, 0]} />
                <Bar dataKey="primeCost" name="Prime Cost" fill={SECONDARY} radius={[4, 4, 0, 0]} />
                <Bar dataKey="variance" name="Cash Variance" fill={DANGER} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartContainer>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">Branch Performance Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="w-full">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Branch</TableHead>
                  <TableHead className="text-right">Net Sales</TableHead>
                  <TableHead className="text-right">Txns</TableHead>
                  <TableHead className="text-right">Avg Ticket</TableHead>
                  <TableHead className="text-right">COGS</TableHead>
                  <TableHead className="text-right">Labor</TableHead>
                  <TableHead className="text-right">Prime Cost %</TableHead>
                  <TableHead className="text-right">Cash Variance</TableHead>
                  <TableHead className="text-right">Closed Shifts</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <BranchRow key={r.branch_id} row={r} format={formatCurrency} />
                ))}
              </TableBody>
            </Table>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}

function KPI({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
          {icon}
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="font-display text-2xl font-semibold tabular-nums text-foreground">{value}</p>
      </CardContent>
    </Card>
  );
}

function BranchRow({
  row,
  format,
}: {
  row: BranchPerformanceRow;
  format: (n: number) => string;
}) {
  const pct = Number(row.prime_cost_pct);
  const pctBadge =
    pct === 0
      ? "secondary"
      : pct <= 60
      ? "default"
      : pct <= 70
      ? "secondary"
      : "destructive";
  const varAbs = Math.abs(Number(row.cash_variance_total));
  const varTone = varAbs < 10 ? "text-success" : varAbs < 50 ? "text-warning" : "text-destructive";

  return (
    <TableRow>
      <TableCell className="max-w-[200px]">
        <div className="flex items-center gap-2">
          <BranchBadge size="sm" branchId={row.branch_id} name={row.branch_name} />
          {row.is_primary && <Star className="h-3 w-3 fill-primary text-primary shrink-0" />}
          {row.branch_code && (
            <span className="text-xs text-muted-foreground">({row.branch_code})</span>
          )}
        </div>
      </TableCell>
      <TableCell className="text-right font-medium">{format(Number(row.net_sales))}</TableCell>
      <TableCell className="text-right">{row.total_transactions}</TableCell>
      <TableCell className="text-right">{format(Number(row.avg_ticket))}</TableCell>
      <TableCell className="text-right">{format(Number(row.cogs_amount))}</TableCell>
      <TableCell className="text-right">{format(Number(row.labor_amount))}</TableCell>
      <TableCell className="text-right">
        <Badge variant={pctBadge as any} className="font-mono">
          {pct.toFixed(1)}%
        </Badge>
      </TableCell>
      <TableCell className={`text-right font-medium ${varTone}`}>
        ±{format(varAbs)}
      </TableCell>
      <TableCell className="text-right">
        {row.closed_shifts_count}
        {Number(row.closed_shifts_count) > 0 && (
          <span className="text-xs text-muted-foreground ml-1">
            ({row.perfect_shifts_count} perfect)
          </span>
        )}
      </TableCell>
    </TableRow>
  );
}
