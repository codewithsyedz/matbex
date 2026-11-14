import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/integrations/db/client";

export interface SalesItemRow {
  branchId: string | null;
  branchName: string;
  currencyCode: string;
  menuItemId: string | null;
  itemName: string;
  category: string;
  quantity: number;
  revenue: number;
  transactionCount: number;
  unitCost: number | null;
  totalCost: number | null;
  grossProfit: number | null;
  marginPct: number | null;
}

export interface SalesItemGroup {
  key: string;
  branchId: string | null;
  branchName: string;
  currencyCode: string;
  rows: SalesItemRow[];
  quantity: number;
  revenue: number;
  cost: number;
  costCoverage: number;
  grossProfit: number;
  marginPct: number;
}

interface RawRow {
  branch_id: string | null;
  branch_name: string;
  currency_code: string;
  menu_item_id: string | null;
  item_name: string;
  category: string;
  quantity: number | string;
  revenue: number | string;
  transaction_count: number | string;
  unit_cost: number | string | null;
  total_cost: number | string | null;
}

const num = (value: number | string | null | undefined) => Number(value ?? 0) || 0;

const toRow = (raw: RawRow): SalesItemRow => {
  const revenue = num(raw.revenue);
  const totalCost = raw.total_cost === null || raw.total_cost === undefined ? null : num(raw.total_cost);
  const grossProfit = totalCost === null ? null : revenue - totalCost;
  return {
    branchId: raw.branch_id,
    branchName: raw.branch_name,
    currencyCode: raw.currency_code,
    menuItemId: raw.menu_item_id,
    itemName: raw.item_name,
    category: raw.category,
    quantity: num(raw.quantity),
    revenue,
    transactionCount: Number(raw.transaction_count ?? 0) || 0,
    unitCost: raw.unit_cost === null || raw.unit_cost === undefined ? null : num(raw.unit_cost),
    totalCost,
    grossProfit,
    marginPct: grossProfit === null || revenue === 0 ? null : (grossProfit / revenue) * 100,
  };
};

const buildGroup = (key: string, rows: SalesItemRow[]): SalesItemGroup => {
  const quantity = rows.reduce((sum, row) => sum + row.quantity, 0);
  const revenue = rows.reduce((sum, row) => sum + row.revenue, 0);
  const cost = rows.reduce((sum, row) => sum + (row.totalCost ?? 0), 0);
  const costCoverage = rows.reduce((sum, row) => sum + (row.totalCost === null ? 0 : row.revenue), 0);
  const grossProfit = costCoverage - cost;
  return {
    key,
    branchId: rows[0]?.branchId ?? null,
    branchName: rows[0]?.branchName ?? "",
    currencyCode: rows[0]?.currencyCode ?? "SAR",
    rows: [...rows].sort((a, b) => b.revenue - a.revenue),
    quantity,
    revenue,
    cost,
    costCoverage,
    grossProfit,
    marginPct: costCoverage === 0 ? 0 : (grossProfit / costCoverage) * 100,
  };
};

export function useSalesItemBreakdown(fromDate: string, toDate: string, branchId: string | null) {
  const { tenant } = useAuth();

  const query = useQuery({
    queryKey: ["sales-item-breakdown", tenant?.id, fromDate, toDate, branchId],
    enabled: !!tenant?.id && !!fromDate && !!toDate,
    queryFn: async () => {
      const { data, error } = await db.rpc("get_sales_item_breakdown", {
        p_tenant_id: tenant!.id,
        p_from_date: fromDate,
        p_to_date: toDate,
        p_branch_id: branchId,
      });
      if (error) throw error;
      return ((data ?? []) as unknown as RawRow[]).map(toRow);
    },
  });

  const groups = useMemo(() => {
    const byKey = new Map<string, SalesItemRow[]>();
    for (const row of query.data ?? []) {
      const key = `${row.branchId ?? "unassigned"}::${row.currencyCode}`;
      const bucket = byKey.get(key);
      if (bucket) bucket.push(row);
      else byKey.set(key, [row]);
    }
    return Array.from(byKey.entries())
      .map(([key, rows]) => buildGroup(key, rows))
      .sort((a, b) => b.revenue - a.revenue);
  }, [query.data]);

  return {
    rows: query.data ?? [],
    groups,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    refetch: query.refetch,
  };
}
