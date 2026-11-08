import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useCurrency } from "@/hooks/useCurrency";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import { Loader2, TrendingUp, TrendingDown, AlertCircle } from "lucide-react";
import { format } from "date-fns";

interface Props {
  dateRange: { from?: Date; to?: Date };
}

// Pair each COGS sub-account with its matching Inventory asset for context.
const CATEGORY_PAIRS: Array<{
  key: string;
  label: string;
  cogsCode: string;
  invCode: string;
}> = [
  { key: "food", label: "Food (general)", cogsCode: "5000", invCode: "1200" },
  { key: "meat", label: "Meat", cogsCode: "5001", invCode: "1201" },
  { key: "veg", label: "Vegetables", cogsCode: "5002", invCode: "1202" },
  { key: "bev", label: "Beverages", cogsCode: "5010", invCode: "1210" },
];

const REVENUE_CODES = ["4000", "4010", "4020"]; // Dine-in, Takeaway, Delivery

export function CategoryMarginReport({ dateRange }: Props) {
  const { tenant } = useAuth();
  const { activeBranchId, pinnedBranchId } = useBranch();
  const branchId = pinnedBranchId ?? activeBranchId ?? null;
  const { format: fmt } = useCurrency();

  const fromIso = dateRange.from ? format(dateRange.from, "yyyy-MM-dd") : null;
  const toIso = dateRange.to ? format(dateRange.to, "yyyy-MM-dd") : null;

  const { data, isLoading } = useQuery({
    queryKey: ["category-margin-report", tenant?.id, branchId, fromIso, toIso],
    enabled: !!tenant?.id && !!fromIso && !!toIso,
    queryFn: async () => {
      // 1. Pull all relevant accounts in one shot.
      const allCodes = [
        ...CATEGORY_PAIRS.map((p) => p.cogsCode),
        ...CATEGORY_PAIRS.map((p) => p.invCode),
        ...REVENUE_CODES,
      ];
      const { data: accts, error: aErr } = await db
        .from("chart_of_accounts")
        .select("id, account_code, account_name, account_type")
        .eq("tenant_id", tenant!.id)
        .in("account_code", allCodes);
      if (aErr) throw aErr;

      const accountIds = (accts || []).map((a) => a.id);
      if (accountIds.length === 0) {
        return { categories: [], totalRevenue: 0 };
      }

      // 2. Pull ledger transactions in the date window.
      let txQuery = db
        .from("account_transactions")
        .select("account_id, debit, credit, transaction_date, is_voided")
        .eq("tenant_id", tenant!.id)
        .in("account_id", accountIds)
        .gte("transaction_date", fromIso)
        .lte("transaction_date", toIso);
      if (branchId) txQuery = txQuery.eq("branch_id", branchId);
      const { data: txns, error: tErr } = await txQuery;
      if (tErr) throw tErr;

      // 3. Aggregate per account.
      const byAccount = new Map<string, { debit: number; credit: number }>();
      for (const t of txns || []) {
        if (t.is_voided) continue;
        const cur = byAccount.get(t.account_id) ?? { debit: 0, credit: 0 };
        cur.debit += Number(t.debit ?? 0);
        cur.credit += Number(t.credit ?? 0);
        byAccount.set(t.account_id, cur);
      }

      const acctByCode = new Map<any, any>(
        (accts || []).map((a) => [a.account_code, a]),
      );

      // Total revenue (credits − debits on revenue accounts).
      let totalRevenue = 0;
      for (const code of REVENUE_CODES) {
        const a = acctByCode.get(code);
        if (!a) continue;
        const b = byAccount.get(a.id);
        if (!b) continue;
        totalRevenue += b.credit - b.debit;
      }

      // Per category COGS = debit − credit on COGS account.
      const cogsRows = CATEGORY_PAIRS.map((p) => {
        const a = acctByCode.get(p.cogsCode);
        const inv = acctByCode.get(p.invCode);
        const b = a ? byAccount.get(a.id) : undefined;
        const invB = inv ? byAccount.get(inv.id) : undefined;
        const cogs = b ? b.debit - b.credit : 0;
        // Net inventory movement in the window (purchases − consumption out).
        const inventoryMovement = invB ? invB.debit - invB.credit : 0;
        return {
          ...p,
          accountFound: !!a,
          inventoryFound: !!inv,
          cogs,
          inventoryMovement,
        };
      });

      const totalCogs = cogsRows.reduce((s, r) => s + r.cogs, 0);

      // Allocate revenue proportionally by COGS share so each category gets a
      // realistic margin (works because revenue isn't tagged per-category).
      const categories = cogsRows.map((r) => {
        const share = totalCogs > 0 ? r.cogs / totalCogs : 0;
        const allocatedRevenue = totalRevenue * share;
        const grossProfit = allocatedRevenue - r.cogs;
        const marginPct = allocatedRevenue > 0 ? (grossProfit / allocatedRevenue) * 100 : 0;
        return { ...r, share, allocatedRevenue, grossProfit, marginPct };
      });

      return { categories, totalRevenue, totalCogs };
    },
  });

  const chartData = useMemo(
    () =>
      (data?.categories ?? [])
        .filter((c) => c.cogs > 0 || c.allocatedRevenue > 0)
        .map((c) => ({
          name: c.label,
          revenue: Math.round(c.allocatedRevenue),
          cogs: Math.round(c.cogs),
          profit: Math.round(c.grossProfit),
        })),
    [data],
  );

  if (isLoading) {
    return (
      <Card>
        <CardContent className="pt-6 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const noData = !data || data.categories.every((c) => c.cogs === 0 && c.allocatedRevenue === 0);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">Per-category gross margin</CardTitle>
          <CardDescription>
            Calculated from your mapped Inventory (1200-series) and COGS (5000-series) sub-accounts.
            Revenue is allocated to each category proportionally to its COGS share, since sales
            aren't tagged per food category in the ledger.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {noData ? (
            <div className="py-10 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
              <AlertCircle className="h-5 w-5" />
              No COGS or revenue activity in this period for the mapped sub-accounts.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Allocated revenue</TableHead>
                  <TableHead className="text-right">COGS</TableHead>
                  <TableHead className="text-right">Gross profit</TableHead>
                  <TableHead className="text-right">Margin</TableHead>
                  <TableHead className="text-right">Inventory Δ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data!.categories.map((c) => (
                  <TableRow key={c.key}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{c.label}</span>
                        <Badge variant="outline" className="font-mono text-[10px] py-0 h-4">
                          {c.cogsCode} / {c.invCode}
                        </Badge>
                        {(!c.accountFound || !c.inventoryFound) && (
                          <Badge variant="outline" className="text-amber-700 border-amber-300 text-[10px] py-0 h-4">
                            missing CoA
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(c.allocatedRevenue)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(c.cogs)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(c.grossProfit)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span className={`inline-flex items-center gap-1 ${c.marginPct >= 0 ? "text-emerald-700" : "text-destructive"}`}>
                        {c.marginPct >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                        {c.marginPct.toFixed(1)}%
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {fmt(c.inventoryMovement)}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-medium border-t-2">
                  <TableCell>Total</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(data!.totalRevenue)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(data!.totalCogs ?? 0)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmt(data!.totalRevenue - (data!.totalCogs ?? 0))}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {data!.totalRevenue > 0
                      ? (((data!.totalRevenue - (data!.totalCogs ?? 0)) / data!.totalRevenue) * 100).toFixed(1)
                      : "0.0"}%
                  </TableCell>
                  <TableCell />
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {chartData.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium">Revenue vs COGS by category</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer
              config={{
                revenue: { label: "Revenue", color: "hsl(var(--chart-1))" },
                cogs: { label: "COGS", color: "hsl(var(--chart-5))" },
                profit: { label: "Gross profit", color: "hsl(var(--chart-2))" },
              }}
              className="h-[280px] w-full"
            >
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={12} />
                <YAxis tickLine={false} axisLine={false} fontSize={12} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="revenue" fill="var(--color-revenue)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="cogs" fill="var(--color-cogs)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="profit" fill="var(--color-profit)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      )}
    </div>
  );
}