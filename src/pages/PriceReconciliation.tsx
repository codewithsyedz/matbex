import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format as formatDate, subDays } from "date-fns";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useCurrency } from "@/hooks/useCurrency";
import { toast } from "@/hooks/use-toast";
import { AlertTriangle, Download, RefreshCw, Search, Wrench } from "lucide-react";
import { BranchBadge } from "@/components/branch/BranchBadge";

export interface PriceVarianceRow {
  sale_item_id: string;
  transaction_id: string;
  receipt_number: string | null;
  sold_at: string;
  sale_date: string;
  branch_id: string | null;
  branch_name: string | null;
  menu_item_id: string;
  item_name: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  expected_quarter: number | null;
  expected_half: number | null;
  expected_full: number | null;
  nearest_expected: number | null;
  variance_per_unit: number;
  variance_total: number;
}

const money = (n: number | null | undefined) => Number(n ?? 0).toFixed(2);

export default function PriceReconciliation() {
  const { restaurant, hasRole } = useAuth();
  const { activeBranchId, isAllBranches } = useBranch();
  const { format: formatMoney } = useCurrency();
  const qc = useQueryClient();

  const canCorrect = hasRole("owner") || hasRole("manager") || hasRole("accountant");
  const branchId = isAllBranches ? null : activeBranchId;

  const [from, setFrom] = useState(formatDate(subDays(new Date(), 30), "yyyy-MM-dd"));
  const [to, setTo] = useState(formatDate(new Date(), "yyyy-MM-dd"));
  const [search, setSearch] = useState("");
  const [target, setTarget] = useState<PriceVarianceRow | null>(null);
  const [newPrice, setNewPrice] = useState("");
  const [reason, setReason] = useState("");

  const { data, isFetching, refetch } = useQuery({
    queryKey: ["price-variance", restaurant?.id, branchId ?? "all", from, to],
    enabled: !!restaurant?.id,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("sales_price_variance" as any, {
        _restaurant_id: restaurant!.id,
        _from: from,
        _to: to,
        _branch_id: branchId,
      });
      if (error) throw error;
      return (data ?? []) as unknown as PriceVarianceRow[];
    },
  });

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = data ?? [];
    if (!q) return list;
    return list.filter((r) =>
      [r.item_name, r.receipt_number, r.branch_name].some((v) =>
        (v ?? "").toLowerCase().includes(q),
      ),
    );
  }, [data, search]);

  const summary = useMemo(() => {
    const over = rows.filter((r) => r.variance_total > 0);
    const under = rows.filter((r) => r.variance_total < 0);
    return {
      count: rows.length,
      receipts: new Set(rows.map((r) => r.transaction_id)).size,
      overcharged: over.reduce((s, r) => s + Number(r.variance_total), 0),
      undercharged: under.reduce((s, r) => s + Number(r.variance_total), 0),
      net: rows.reduce((s, r) => s + Number(r.variance_total), 0),
    };
  }, [rows]);

  const correct = useMutation({
    mutationFn: async (payload: { id: string; price: number; reason: string }) => {
      const { data, error } = await supabase.rpc("correct_sale_item_price" as any, {
        _sale_item_id: payload.id,
        _new_unit_price: payload.price,
        _reason: payload.reason || null,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast({ title: "Price corrected", description: "Receipt totals and VAT were recalculated." });
      setTarget(null);
      setReason("");
      qc.invalidateQueries({ queryKey: ["price-variance"] });
      qc.invalidateQueries({ queryKey: ["sales"] });
    },
    onError: (e: any) =>
      toast({ title: "Correction failed", description: e.message, variant: "destructive" }),
  });

  const exportCsv = () => {
    const header = [
      "sale_date", "receipt", "branch", "item", "qty", "recorded_unit_price",
      "expected_quarter", "expected_half", "expected_full", "closest_expected",
      "variance_per_unit", "variance_total",
    ];
    const body = rows.map((r) => [
      r.sale_date, r.receipt_number ?? "", r.branch_name ?? "", r.item_name, r.quantity,
      money(r.unit_price), money(r.expected_quarter), money(r.expected_half),
      money(r.expected_full), money(r.nearest_expected), money(r.variance_per_unit),
      money(r.variance_total),
    ]);
    const csv = [header, ...body]
      .map((line) => line.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `price-reconciliation_${branchId ? "branch" : "all"}_${from}_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const openFix = (row: PriceVarianceRow) => {
    setTarget(row);
    setNewPrice(String(row.nearest_expected ?? row.unit_price));
    setReason("");
  };

  return (
    <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3 min-h-[56px]">
          <div className="min-w-[240px] flex-1"><h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight">Price Reconciliation</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Sale lines whose recorded price doesn't match any branch price that was
            effective on the day of sale.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!rows.length}>
            <Download className="mr-2 h-4 w-4" /> Export CSV
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-3"><CardDescription>Flagged lines</CardDescription></CardHeader>
          <CardContent className="text-2xl font-light">
            {summary.count}
            <span className="ml-2 text-xs text-muted-foreground">{summary.receipts} receipts</span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3"><CardDescription>Overcharged</CardDescription></CardHeader>
          <CardContent className="text-2xl font-light text-destructive">
            {formatMoney(summary.overcharged)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3"><CardDescription>Undercharged</CardDescription></CardHeader>
          <CardContent className="text-2xl font-light">
            {formatMoney(Math.abs(summary.undercharged))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3"><CardDescription>Net impact</CardDescription></CardHeader>
          <CardContent className="text-2xl font-light">{formatMoney(summary.net)}</CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">
            {isAllBranches ? "All branches" : "Active branch"}
          </CardTitle>
          <CardDescription>
            Expected prices come from the branch price list effective on the sale date,
            falling back to the tenant-wide menu price.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="pr-from" className="text-xs">From</Label>
              <Input id="pr-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pr-to" className="text-xs">To</Label>
              <Input id="pr-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
            </div>
            <div className="relative min-w-[220px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search item, receipt or branch…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>

          {!rows.length ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {isFetching ? "Checking sales…" : "No price mismatches in this period."}
            </p>
          ) : (
            <ScrollArea className="max-h-[60vh]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Receipt</TableHead>
                    <TableHead>Branch</TableHead>
                    <TableHead>Item</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Recorded</TableHead>
                    <TableHead className="text-right">Expected (Q / H / F)</TableHead>
                    <TableHead className="text-right">Variance</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.sale_item_id}>
                      <TableCell className="whitespace-nowrap">{r.sale_date}</TableCell>
                      <TableCell className="font-mono text-xs">{r.receipt_number ?? "—"}</TableCell>
                      <TableCell className="max-w-[150px]">
                        <BranchBadge size="sm" branchId={r.branch_id} name={r.branch_name} />
                      </TableCell>
                      <TableCell>{r.item_name}</TableCell>
                      <TableCell className="text-right">{r.quantity}</TableCell>
                      <TableCell className="text-right">{money(r.unit_price)}</TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {money(r.expected_quarter)} / {money(r.expected_half)} / {money(r.expected_full)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant={r.variance_total > 0 ? "destructive" : "secondary"}>
                          {r.variance_total > 0 ? "+" : ""}{money(r.variance_total)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => openFix(r)}
                          disabled={!canCorrect}
                        >
                          <Wrench className="mr-1 h-3.5 w-3.5" /> Fix
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!target} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Correct recorded price</DialogTitle>
            <DialogDescription>
              {target?.item_name} · receipt {target?.receipt_number ?? "—"} · {target?.sale_date}
            </DialogDescription>
          </DialogHeader>

          {target && (
            <div className="space-y-4">
              <div className="rounded-md border p-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Recorded</span>
                  <span>{money(target.unit_price)} × {target.quantity} = {money(target.line_total)}</span>
                </div>
                <div className="mt-1 flex justify-between">
                  <span className="text-muted-foreground">Closest effective price</span>
                  <span>{money(target.nearest_expected)}</span>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {([
                  ["Quarter", target.expected_quarter],
                  ["Half", target.expected_half],
                  ["Full", target.expected_full],
                ] as const)
                  .filter(([, v]) => v != null && Number(v) > 0)
                  .map(([label, v]) => (
                    <Button
                      key={label}
                      type="button"
                      size="sm"
                      variant={Number(newPrice) === Number(v) ? "default" : "outline"}
                      onClick={() => setNewPrice(String(v))}
                    >
                      {label}: {money(v as number)}
                    </Button>
                  ))}
              </div>

              <div className="space-y-1">
                <Label htmlFor="pr-price">Corrected unit price</Label>
                <Input
                  id="pr-price"
                  type="number"
                  step="0.01"
                  min="0"
                  value={newPrice}
                  onChange={(e) => setNewPrice(e.target.value)}
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="pr-reason">Reason (audit trail)</Label>
                <Input
                  id="pr-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. terminal served stale branch price"
                />
              </div>

              <p className="flex items-start gap-2 rounded-md bg-muted p-3 text-xs text-muted-foreground">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Saving rewrites this line and recalculates the receipt's net, VAT and gross
                totals using the branch VAT rate and pricing mode. The change is written to
                the audit log.
              </p>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)}>Cancel</Button>
            <Button
              onClick={() =>
                target &&
                correct.mutate({ id: target.sale_item_id, price: Number(newPrice), reason })
              }
              disabled={
                correct.isPending || !newPrice || Number.isNaN(Number(newPrice)) || Number(newPrice) < 0
              }
            >
              {correct.isPending ? "Saving…" : "Apply correction"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
