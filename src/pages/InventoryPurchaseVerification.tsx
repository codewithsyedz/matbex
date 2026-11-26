import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { format, subDays } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, CheckCircle2, FileDown, RefreshCw } from "lucide-react";

import { db } from "@/integrations/db/client";
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

/**
 * Inventory Purchase Verification
 * --------------------------------
 * Recomputes the expected stock/cost impact from expense entries that are
 * flagged as inventory items, and compares against the `purchases` rows
 * actually created from those expenses. Mismatches (quantity, total cost,
 * unit cost / implied WAC delta, or missing/extra purchase rows) are surfaced
 * for manual review.
 */

type ExpenseRow = {
  id: string;
  expense_date: string;
  amount: number;
  quantity: number | null;
  inventory_item_id: string;
  branch_id: string | null;
  description: string | null;
};

type PurchaseRow = {
  id: string;
  received_at: string;
  inventory_item_id: string;
  branch_id: string | null;
  quantity_received: number;
  unit_cost: number;
  total_cost: number;
};

type ItemMeta = {
  id: string;
  name: string;
  unit: string | null;
  current_stock: number;
  unit_cost: number;
};

type GroupKey = string; // `${date}|${itemId}|${branchId ?? "_"}`

type ReconRow = {
  key: GroupKey;
  date: string;
  itemId: string;
  branchId: string | null;
  expectedQty: number;
  expectedCost: number;
  actualQty: number;
  actualCost: number;
  expenseIds: string[];
  purchaseIds: string[];
  qtyDelta: number;
  costDelta: number;
  expectedUnit: number | null;
  actualUnit: number | null;
  /** WAC the item would have *if only the expected purchases were posted* */
  wacExpected: number | null;
  /** WAC the item would have using actual purchases */
  wacActual: number | null;
  status: "ok" | "missing_purchase" | "extra_purchase" | "qty_mismatch" | "cost_mismatch";
};

const EPS = 0.01;

function fmtNum(n: number) {
  return Number(n).toFixed(2);
}

export default function InventoryPurchaseVerification() {
  const { profile } = useAuth();
  const { activeBranchId } = useBranch();
  const { format: formatAmount } = useCurrency();

  const [dateFrom, setDateFrom] = useState(format(subDays(new Date(), 30), "yyyy-MM-dd"));
  const [dateTo, setDateTo] = useState(format(new Date(), "yyyy-MM-dd"));
  const [onlyMismatches, setOnlyMismatches] = useState(true);

  const tenantId = profile?.tenant_id ?? null;

  const { data, isFetching, refetch } = useQuery({
    queryKey: [
      "inv-purchase-verify",
      tenantId,
      activeBranchId,
      dateFrom,
      dateTo,
    ],
    enabled: !!tenantId,
    queryFn: async () => {
      // 1) Inventory-flagged expenses in range
      let eq = (db as any)
        .from("expenses")
        .select("id, expense_date, amount, quantity, inventory_item_id, branch_id, description")
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .eq("is_inventory_item", true)
        .not("inventory_item_id", "is", null)
        .gte("expense_date", dateFrom)
        .lte("expense_date", dateTo);
      if (activeBranchId) eq = eq.eq("branch_id", activeBranchId);
      const { data: expRows, error: expErr } = await eq;
      if (expErr) throw expErr;
      const expenses: ExpenseRow[] = (expRows ?? []).map((r: any) => ({
        id: r.id,
        expense_date: r.expense_date,
        amount: Number(r.amount ?? 0),
        quantity: r.quantity == null ? null : Number(r.quantity),
        inventory_item_id: r.inventory_item_id,
        branch_id: r.branch_id,
        description: r.description,
      }));

      // 2) Purchases in range (same tenant/branch)
      let pq = (db as any)
        .from("purchases")
        .select(
          "id, received_at, inventory_item_id, branch_id, quantity_received, unit_cost, total_cost"
        )
        .gte("received_at", `${dateFrom}T00:00:00Z`)
        .lte("received_at", `${dateTo}T23:59:59Z`);
      if (activeBranchId) pq = pq.eq("branch_id", activeBranchId);
      const { data: purRows, error: purErr } = await pq;
      if (purErr) throw purErr;
      const purchases: PurchaseRow[] = (purRows ?? []).map((r: any) => ({
        id: r.id,
        received_at: r.received_at,
        inventory_item_id: r.inventory_item_id,
        branch_id: r.branch_id,
        quantity_received: Number(r.quantity_received ?? 0),
        unit_cost: Number(r.unit_cost ?? 0),
        total_cost: Number(r.total_cost ?? 0),
      }));

      // 3) Item metadata for WAC calc
      const itemIds = Array.from(
        new Set([
          ...expenses.map((e) => e.inventory_item_id),
          ...purchases.map((p) => p.inventory_item_id),
        ])
      ).filter(Boolean);

      const items: Record<string, ItemMeta> = {};
      if (itemIds.length > 0) {
        const { data: itemRows } = await (db as any)
          .from("inventory_items")
          .select("id, name, unit, current_stock, unit_cost")
          .in("id", itemIds);
        for (const it of itemRows ?? []) {
          items[it.id] = {
            id: it.id,
            name: it.name,
            unit: it.unit,
            current_stock: Number(it.current_stock ?? 0),
            unit_cost: Number(it.unit_cost ?? 0),
          };
        }
      }

      // 4) Group both sides by (date, item, branch)
      const groups = new Map<GroupKey, ReconRow>();
      const keyOf = (date: string, item: string, branch: string | null) =>
        `${date}|${item}|${branch ?? "_"}`;

      for (const e of expenses) {
        const k = keyOf(e.expense_date, e.inventory_item_id, e.branch_id);
        const g = groups.get(k) ?? {
          key: k,
          date: e.expense_date,
          itemId: e.inventory_item_id,
          branchId: e.branch_id,
          expectedQty: 0,
          expectedCost: 0,
          actualQty: 0,
          actualCost: 0,
          expenseIds: [],
          purchaseIds: [],
          qtyDelta: 0,
          costDelta: 0,
          expectedUnit: null,
          actualUnit: null,
          wacExpected: null,
          wacActual: null,
          status: "ok",
        };
        g.expectedQty += e.quantity ?? 0;
        g.expectedCost += e.amount;
        g.expenseIds.push(e.id);
        groups.set(k, g);
      }

      for (const p of purchases) {
        const date = p.received_at.slice(0, 10);
        const k = keyOf(date, p.inventory_item_id, p.branch_id);
        const g = groups.get(k) ?? {
          key: k,
          date,
          itemId: p.inventory_item_id,
          branchId: p.branch_id,
          expectedQty: 0,
          expectedCost: 0,
          actualQty: 0,
          actualCost: 0,
          expenseIds: [],
          purchaseIds: [],
          qtyDelta: 0,
          costDelta: 0,
          expectedUnit: null,
          actualUnit: null,
          wacExpected: null,
          wacActual: null,
          status: "ok",
        };
        g.actualQty += p.quantity_received;
        g.actualCost += p.total_cost;
        g.purchaseIds.push(p.id);
        groups.set(k, g);
      }

      // 5) Compute deltas, implied unit cost, WAC impact, and status
      for (const g of groups.values()) {
        g.qtyDelta = g.actualQty - g.expectedQty;
        g.costDelta = g.actualCost - g.expectedCost;
        g.expectedUnit = g.expectedQty > 0 ? g.expectedCost / g.expectedQty : null;
        g.actualUnit = g.actualQty > 0 ? g.actualCost / g.actualQty : null;

        const meta = items[g.itemId];
        if (meta) {
          const baseStock = meta.current_stock;
          const baseCost = meta.unit_cost;
          const wac = (addQty: number, addCost: number) => {
            const denom = baseStock + addQty;
            if (denom <= 0) return null;
            return (baseStock * baseCost + addCost) / denom;
          };
          g.wacExpected = wac(g.expectedQty, g.expectedCost);
          g.wacActual = wac(g.actualQty, g.actualCost);
        }

        if (g.expenseIds.length > 0 && g.purchaseIds.length === 0) {
          g.status = "missing_purchase";
        } else if (g.purchaseIds.length > 0 && g.expenseIds.length === 0) {
          g.status = "extra_purchase";
        } else if (Math.abs(g.qtyDelta) > EPS) {
          g.status = "qty_mismatch";
        } else if (Math.abs(g.costDelta) > EPS) {
          g.status = "cost_mismatch";
        } else {
          g.status = "ok";
        }
      }

      const rows = Array.from(groups.values()).sort((a, b) =>
        a.date === b.date
          ? (items[a.itemId]?.name ?? "").localeCompare(items[b.itemId]?.name ?? "")
          : a.date < b.date
          ? 1
          : -1
      );

      return { rows, items };
    },
  });

  const rows = data?.rows ?? [];
  const items = data?.items ?? {};

  const visible = useMemo(
    () => (onlyMismatches ? rows.filter((r) => r.status !== "ok") : rows),
    [rows, onlyMismatches]
  );

  const totals = useMemo(() => {
    const okCount = rows.filter((r) => r.status === "ok").length;
    const mismatchCount = rows.length - okCount;
    const totalExpected = rows.reduce((s, r) => s + r.expectedCost, 0);
    const totalActual = rows.reduce((s, r) => s + r.actualCost, 0);
    return { okCount, mismatchCount, totalExpected, totalActual };
  }, [rows]);

  const exportCsv = () => {
    if (visible.length === 0) {
      toast.error("Nothing to export");
      return;
    }
    const header = [
      "date",
      "item",
      "status",
      "expected_qty",
      "actual_qty",
      "qty_delta",
      "expected_cost",
      "actual_cost",
      "cost_delta",
      "expected_unit",
      "actual_unit",
      "wac_expected",
      "wac_actual",
      "expense_ids",
      "purchase_ids",
    ];
    const lines = [header.join(",")];
    for (const r of visible) {
      lines.push(
        [
          r.date,
          JSON.stringify(items[r.itemId]?.name ?? r.itemId),
          r.status,
          fmtNum(r.expectedQty),
          fmtNum(r.actualQty),
          fmtNum(r.qtyDelta),
          fmtNum(r.expectedCost),
          fmtNum(r.actualCost),
          fmtNum(r.costDelta),
          r.expectedUnit == null ? "" : fmtNum(r.expectedUnit),
          r.actualUnit == null ? "" : fmtNum(r.actualUnit),
          r.wacExpected == null ? "" : fmtNum(r.wacExpected),
          r.wacActual == null ? "" : fmtNum(r.wacActual),
          JSON.stringify(r.expenseIds.join("|")),
          JSON.stringify(r.purchaseIds.join("|")),
        ].join(",")
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `inventory-purchase-verification_${dateFrom}_to_${dateTo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const statusBadge = (s: ReconRow["status"]) => {
    switch (s) {
      case "ok":
        return (
          <Badge variant="outline" className="gap-1">
            <CheckCircle2 className="h-3 w-3 text-emerald-600" /> Balanced
          </Badge>
        );
      case "missing_purchase":
        return <Badge variant="destructive">Missing purchase</Badge>;
      case "extra_purchase":
        return <Badge variant="destructive">Extra purchase</Badge>;
      case "qty_mismatch":
        return <Badge variant="destructive">Qty mismatch</Badge>;
      case "cost_mismatch":
        return <Badge variant="destructive">Cost mismatch</Badge>;
    }
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
            Inventory Purchase Verification
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Recomputes expected stock and weighted‑average cost (WAC) impact from inventory‑linked
            expenses and compares with the purchase rows that were actually created. Mismatches are
            flagged for review.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button
            variant={onlyMismatches ? "default" : "outline"}
            size="sm"
            onClick={() => setOnlyMismatches((v) => !v)}
          >
            {onlyMismatches ? "Showing mismatches" : "Showing all"}
          </Button>
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
            <Badge variant="outline">{rows.length} groups</Badge>
            <Badge variant="outline" className="text-emerald-700">
              {totals.okCount} balanced
            </Badge>
            <Badge variant={totals.mismatchCount ? "destructive" : "outline"}>
              {totals.mismatchCount} mismatch
            </Badge>
            <Badge variant="secondary">
              Expected {formatAmount(totals.totalExpected)} · Actual{" "}
              {formatAmount(totals.totalActual)}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {visible.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-center text-sm text-muted-foreground">
            {rows.length === 0
              ? "No inventory‑linked expenses or purchases in this date range."
              : "All inventory‑linked expenses reconcile to their purchase rows. 🎉"}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Reconciliation results
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Exp. qty</TableHead>
                  <TableHead className="text-right">Act. qty</TableHead>
                  <TableHead className="text-right">Δ qty</TableHead>
                  <TableHead className="text-right">Exp. cost</TableHead>
                  <TableHead className="text-right">Act. cost</TableHead>
                  <TableHead className="text-right">Δ cost</TableHead>
                  <TableHead className="text-right">Exp. unit</TableHead>
                  <TableHead className="text-right">Act. unit</TableHead>
                  <TableHead className="text-right">WAC (exp → act)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((r) => {
                  const meta = items[r.itemId];
                  return (
                    <TableRow key={r.key}>
                      <TableCell className="font-mono text-xs">{r.date}</TableCell>
                      <TableCell className="font-medium">
                        {meta?.name ?? r.itemId.slice(0, 8)}
                        {meta?.unit ? (
                          <span className="text-muted-foreground"> · {meta.unit}</span>
                        ) : null}
                      </TableCell>
                      <TableCell>{statusBadge(r.status)}</TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {fmtNum(r.expectedQty)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {fmtNum(r.actualQty)}
                      </TableCell>
                      <TableCell
                        className={`text-right font-mono text-xs ${
                          Math.abs(r.qtyDelta) > EPS ? "text-destructive" : ""
                        }`}
                      >
                        {fmtNum(r.qtyDelta)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {formatAmount(r.expectedCost)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {formatAmount(r.actualCost)}
                      </TableCell>
                      <TableCell
                        className={`text-right font-mono text-xs ${
                          Math.abs(r.costDelta) > EPS ? "text-destructive" : ""
                        }`}
                      >
                        {formatAmount(r.costDelta)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {r.expectedUnit == null ? "—" : formatAmount(r.expectedUnit)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {r.actualUnit == null ? "—" : formatAmount(r.actualUnit)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {r.wacExpected == null ? "—" : formatAmount(r.wacExpected)}
                        {" → "}
                        {r.wacActual == null ? "—" : formatAmount(r.wacActual)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}