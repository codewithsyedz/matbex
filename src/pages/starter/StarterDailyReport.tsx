import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useStarterDaily, formatMoney } from "@/hooks/useStarterDaily";

export default function StarterDailyReport() {
  const { data, isLoading } = useStarterDaily(30);
  const rows = data ?? [];

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold">Daily report</h1>
        <p className="text-sm text-muted-foreground">Sales, expenses and profit for each day — last 30 days.</p>
      </div>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">By day</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          {isLoading ? <div className="p-4"><Skeleton className="h-40 w-full" /></div> : rows.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No days recorded yet. Close a day from the till or Sales page.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-end">Cash</TableHead>
                  <TableHead className="text-end">Card</TableHead>
                  <TableHead className="text-end">Other</TableHead>
                  <TableHead className="text-end">Sales</TableHead>
                  <TableHead className="text-end">Expenses</TableHead>
                  <TableHead className="text-end">Profit</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.date}>
                    <TableCell className="whitespace-nowrap">{r.date}</TableCell>
                    <TableCell className="text-end tabular-nums">{formatMoney(r.cash)}</TableCell>
                    <TableCell className="text-end tabular-nums">{formatMoney(r.card)}</TableCell>
                    <TableCell className="text-end tabular-nums">{formatMoney(r.other)}</TableCell>
                    <TableCell className="text-end tabular-nums font-medium">{formatMoney(r.total)}</TableCell>
                    <TableCell className="text-end tabular-nums">{formatMoney(r.expenses)}</TableCell>
                    <TableCell className="text-end tabular-nums font-medium">{formatMoney(r.total - r.expenses)}</TableCell>
                    <TableCell>{r.status ? <Badge variant="outline">{r.status}</Badge> : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
