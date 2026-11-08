import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { format, subDays } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, FileDown, RefreshCw } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useCurrency } from "@/hooks/useCurrency";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { BranchBadge } from "@/components/branch/BranchBadge";

/**
 * Categories whose expenses should always be linked to an inventory item.
 * Keep this regex aligned with RecordExpenseDialog.tsx > INVENTORY_BACKED_CATEGORY_RE.
 */
const INVENTORY_BACKED_CATEGORY_RE =
  /\b(meat|chicken|beef|lamb|mutton|fish|seafood|poultry|food|ingredient|produce|vegetables?|veg|fruits?|groceries|grocery|spices?|flour|rice|bread|oils?|dairy|milk|cheese|yog(?:h)?urt|cream|butter|labneh|ghee|beverages?|drinks?|sodas?|juices?|waters?|coffee|tea|gas|cylinder|propane|lpg|packaging|container|wrap|napkin|disposable|takeaway|bag)\b/i;

type AuditRow = {
  id: string;
  expense_date: string;
  description: string | null;
  amount: number;
  category_id: string | null;
  category_name: string;
  inventory_item_id: string | null;
  is_inventory_item: boolean | null;
  branch_id: string | null;
  branch_name: string | null;
  reason: "missing_link" | "flag_off";
};

export default function InventoryLinkAudit() {
  const { profile } = useAuth();
  const { activeBranchId } = useBranch();
  const { format: formatAmount } = useCurrency();

  const [dateFrom, setDateFrom] = useState(format(subDays(new Date(), 30), "yyyy-MM-dd"));
  const [dateTo, setDateTo] = useState(format(new Date(), "yyyy-MM-dd"));

  const tenantId = profile?.tenant_id ?? null;

  const { data, isFetching, refetch } = useQuery({
    queryKey: ["inventory-link-audit", tenantId, activeBranchId, dateFrom, dateTo],
    enabled: !!tenantId,
    queryFn: async (): Promise<AuditRow[]> => {
      let q = (supabase as any)
        .from("expenses")
        .select(
          "id, expense_date, description, amount, category_id, inventory_item_id, is_inventory_item, branch_id, expense_categories(name), branches(name)"
        )
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .gte("expense_date", dateFrom)
        .lte("expense_date", dateTo)
        .order("expense_date", { ascending: false });

      if (activeBranchId) q = q.eq("branch_id", activeBranchId);

      const { data: rows, error } = await q;
      if (error) throw error;

      const list: AuditRow[] = (rows ?? [])
        .map((r: any) => {
          const categoryName = r.expense_categories?.name ?? "";
          const isInventoryBacked = INVENTORY_BACKED_CATEGORY_RE.test(categoryName);
          if (!isInventoryBacked) return null;

          const flagOff = r.is_inventory_item !== true;
          const missingLink = !r.inventory_item_id;
          if (!flagOff && !missingLink) return null;

          return {
            id: r.id,
            expense_date: r.expense_date,
            description: r.description,
            amount: Number(r.amount ?? 0),
            category_id: r.category_id,
            category_name: categoryName,
            inventory_item_id: r.inventory_item_id,
            is_inventory_item: r.is_inventory_item,
            branch_id: r.branch_id,
            branch_name: r.branches?.name ?? null,
            reason: missingLink ? "missing_link" : "flag_off",
          } as AuditRow;
        })
        .filter(Boolean) as AuditRow[];

      return list;
    },
  });

  const rows = data ?? [];

  const totals = useMemo(() => {
    const total = rows.reduce((s, r) => s + r.amount, 0);
    const missing = rows.filter((r) => r.reason === "missing_link").length;
    const flagged = rows.filter((r) => r.reason === "flag_off").length;
    return { total, missing, flagged };
  }, [rows]);

  const byDate = useMemo(() => {
    const map = new Map<string, AuditRow[]>();
    for (const r of rows) {
      const arr = map.get(r.expense_date) ?? [];
      arr.push(r);
      map.set(r.expense_date, arr);
    }
    return Array.from(map.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [rows]);

  const exportCsv = () => {
    if (rows.length === 0) {
      toast.error("Nothing to export");
      return;
    }
    const header = [
      "expense_date",
      "category",
      "description",
      "amount",
      "branch",
      "reason",
      "expense_id",
    ];
    const lines = [header.join(",")];
    for (const r of rows) {
      lines.push(
        [
          r.expense_date,
          JSON.stringify(r.category_name),
          JSON.stringify(r.description ?? ""),
          r.amount.toFixed(2),
          JSON.stringify(r.branch_name ?? ""),
          r.reason,
          r.id,
        ].join(",")
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `inventory-link-audit_${dateFrom}_to_${dateTo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <Link to="/expenses" className="inline-flex items-center gap-1 hover:text-foreground">
              <ArrowLeft className="h-3.5 w-3.5" /> Expenses
            </Link>
          </div>
          <h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight">
            Inventory Link Audit
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Expenses in inventory-backed categories that are missing an inventory item link or
            still have the inventory flag turned off.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5">
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={exportCsv} className="gap-1.5">
            <FileDown className="h-4 w-4" />
            Export CSV
          </Button>
        </div>
      </header>

      <Card className="mb-4">
        <CardContent className="pt-6 grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <div>
            <Label className="text-xs">From</Label>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>
          <div>
            <Label className="text-xs">To</Label>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
          <div className="md:col-span-2 flex flex-wrap gap-2 text-xs">
            <Badge variant="outline">{rows.length} flagged expense(s)</Badge>
            <Badge variant="outline">{totals.missing} missing link</Badge>
            <Badge variant="outline">{totals.flagged} flag off</Badge>
            <Badge variant="secondary">Total {formatAmount(totals.total)}</Badge>
          </div>
        </CardContent>
      </Card>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-center text-sm text-muted-foreground">
            No inventory-link issues in this date range. 🎉
          </CardContent>
        </Card>
      ) : (
        byDate.map(([date, dayRows]) => (
          <Card key={date} className="mb-4">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                {date}
                <span className="text-muted-foreground font-normal">
                  · {dayRows.length} entry(s) ·{" "}
                  {formatAmount(dayRows.reduce((s, r) => s + r.amount, 0))}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Category</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Branch</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dayRows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.category_name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {r.description || "—"}
                      </TableCell>
                      <TableCell className="max-w-[150px]">
                        <BranchBadge
                          size="sm"
                          branchId={r.branch_id}
                          name={r.branch_name}
                        />
                      </TableCell>
                      <TableCell>
                        {r.reason === "missing_link" ? (
                          <Badge variant="destructive">No inventory item</Badge>
                        ) : (
                          <Badge variant="outline">Flag off</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {formatAmount(r.amount)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}