import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO, subDays } from "date-fns";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type BalanceSheetSection = "asset" | "liability" | "equity";

export interface BalanceSheetLine {
  branchId: string | null;
  branchName: string;
  currencyCode: string;
  accountId: string;
  accountCode: string;
  accountName: string;
  section: BalanceSheetSection;
  balance: number;
  isDerived?: boolean;
  derivedKind?: "accumulated" | "retained" | "currentPeriod";
}

export interface BalanceSheetGroup {
  key: string;
  branchId: string | null;
  branchName: string;
  currencyCode: string;
  lines: BalanceSheetLine[];
  assets: number;
  liabilities: number;
  equity: number;
  variance: number;
  retainedEarnings: number;
  currentPeriodEarnings: number;
}

interface LedgerRow {
  branch_id: string | null;
  branch_name: string;
  currency_code: string;
  account_id: string;
  account_code: string;
  account_name: string;
  account_type: "asset" | "liability" | "equity" | "revenue" | "cogs" | "expense";
  natural_balance: number;
}

const earningsTotal = (rows: LedgerRow[]) => rows.reduce((sum, row) => {
  const amount = Number(row.natural_balance);
  if (row.account_type === "revenue") return sum + amount;
  if (row.account_type === "cogs" || row.account_type === "expense") return sum - amount;
  return sum;
}, 0);

export function useBalanceSheet(asOfDate: string, branchId: string | null, earningsFromDate?: string) {
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id;

  const query = useQuery({
    queryKey: ["balance-sheet", tenantId, asOfDate, branchId],
    enabled: Boolean(tenantId && asOfDate),
    queryFn: async () => {
      if (!tenantId) throw new Error("Tenant context is required");
      const { data, error } = await supabase.rpc("get_balance_sheet_by_branch", {
        p_tenant_id: tenantId,
        p_as_of_date: asOfDate,
        p_branch_id: branchId,
      });
      if (error) throw error;
      return (data ?? []) as LedgerRow[];
    },
    staleTime: 2 * 60 * 1000,
  });

  const openingDate = earningsFromDate
    ? format(subDays(parseISO(earningsFromDate), 1), "yyyy-MM-dd")
    : null;
  const openingQuery = useQuery({
    queryKey: ["balance-sheet-opening-earnings", tenantId, openingDate, branchId],
    enabled: Boolean(tenantId && openingDate),
    queryFn: async () => {
      if (!tenantId || !openingDate) throw new Error("Opening earnings date is required");
      const { data, error } = await supabase.rpc("get_balance_sheet_by_branch", {
        p_tenant_id: tenantId,
        p_as_of_date: openingDate,
        p_branch_id: branchId,
      });
      if (error) throw error;
      return (data ?? []) as LedgerRow[];
    },
    staleTime: 2 * 60 * 1000,
  });

  const groups = useMemo<BalanceSheetGroup[]>(() => {
    const source = query.data ?? [];
    const openingByBranch = new Map<string, LedgerRow[]>();
    for (const row of openingQuery.data ?? []) {
      const key = row.branch_id ?? "unassigned";
      const current = openingByBranch.get(key) ?? [];
      current.push(row);
      openingByBranch.set(key, current);
    }
    const byBranch = new Map<string, LedgerRow[]>();
    for (const row of source) {
      const key = row.branch_id ?? "unassigned";
      const current = byBranch.get(key) ?? [];
      current.push(row);
      byBranch.set(key, current);
    }

    return Array.from(byBranch.entries()).map(([key, rows]) => {
      const first = rows[0];
      const lines: BalanceSheetLine[] = rows
        .filter((row) => row.account_type === "asset" || row.account_type === "liability" || row.account_type === "equity")
        .map((row) => ({
          branchId: row.branch_id,
          branchName: row.branch_name,
          currencyCode: row.currency_code,
          accountId: row.account_id,
          accountCode: row.account_code,
          accountName: row.account_name,
          section: row.account_type as BalanceSheetSection,
          balance: Number(row.natural_balance),
        }));

      const accumulatedEarnings = earningsTotal(rows);
      const retainedEarnings = earningsFromDate ? earningsTotal(openingByBranch.get(key) ?? []) : 0;
      const currentPeriodEarnings = earningsFromDate ? accumulatedEarnings - retainedEarnings : accumulatedEarnings;

      if (earningsFromDate && Math.abs(retainedEarnings) >= 0.005) {
        lines.push({
          branchId: first?.branch_id ?? null,
          branchName: first?.branch_name ?? "Unassigned",
          currencyCode: first?.currency_code ?? "SAR",
          accountId: `retained-earnings-${key}`,
          accountCode: "—",
          accountName: "Retained earnings before period",
          section: "equity",
          balance: retainedEarnings,
          isDerived: true,
          derivedKind: "retained",
        });
      }

      if (Math.abs(currentPeriodEarnings) >= 0.005) {
        lines.push({
          branchId: first?.branch_id ?? null,
          branchName: first?.branch_name ?? "Unassigned",
          currencyCode: first?.currency_code ?? "SAR",
          accountId: `${earningsFromDate ? "current-period-earnings" : "accumulated-earnings"}-${key}`,
          accountCode: "—",
          accountName: earningsFromDate ? "Current-period earnings" : "Accumulated earnings",
          section: "equity",
          balance: currentPeriodEarnings,
          isDerived: true,
          derivedKind: earningsFromDate ? "currentPeriod" : "accumulated",
        });
      }

      lines.sort((a, b) => a.accountCode.localeCompare(b.accountCode));
      const total = (section: BalanceSheetSection) =>
        lines.filter((line) => line.section === section).reduce((sum, line) => sum + line.balance, 0);
      const assets = total("asset");
      const liabilities = total("liability");
      const equity = total("equity");

      return {
        key,
        branchId: first?.branch_id ?? null,
        branchName: first?.branch_name ?? "Unassigned",
        currencyCode: first?.currency_code ?? "SAR",
        lines,
        assets,
        liabilities,
        equity,
        variance: assets - liabilities - equity,
        retainedEarnings,
        currentPeriodEarnings,
      };
    });
  }, [earningsFromDate, openingQuery.data, query.data]);

  const consolidated = useMemo(() => {
    const assets = groups.reduce((sum, group) => sum + group.assets, 0);
    const liabilities = groups.reduce((sum, group) => sum + group.liabilities, 0);
    const equity = groups.reduce((sum, group) => sum + group.equity, 0);
    return { assets, liabilities, equity, variance: assets - liabilities - equity };
  }, [groups]);

  return {
    groups,
    consolidated,
    isLoading: query.isLoading || openingQuery.isLoading,
    isFetching: query.isFetching || openingQuery.isFetching,
    error: query.error ?? openingQuery.error,
    refetch: async () => {
      const results = await Promise.all([
        query.refetch(),
        ...(openingDate ? [openingQuery.refetch()] : []),
      ]);
      return results;
    },
  };
}