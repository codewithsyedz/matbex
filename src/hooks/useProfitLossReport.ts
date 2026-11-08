import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

export type ProfitLossSection = "revenue" | "cogs" | "expense";

export interface ProfitLossLine {
  accountId: string;
  code: string;
  name: string;
  section: ProfitLossSection;
  amount: number;
}

export interface ProfitLossExpenseLine {
  transactionId: string;
  branchId: string | null;
  branchName: string;
  currencyCode: string;
  accountId: string;
  transactionDate: string;
  description: string;
  referenceType: string;
  referenceId: string | null;
  paymentMethod: string | null;
  supplierName: string | null;
  amount: number;
  isExpenseSource: boolean;
}

export interface ProfitLossGroup {
  key: string;
  branchId: string | null;
  branchName: string;
  currencyCode: string;
  lines: ProfitLossLine[];
  expenseLines: ProfitLossExpenseLine[];
  revenue: number;
  cogs: number;
  grossProfit: number;
  expenses: number;
  netProfit: number;
  grossMargin: number;
  netMargin: number;
}

interface LedgerRow {
  branch_id: string | null;
  branch_name: string;
  currency_code: string;
  account_id: string;
  account_code: string;
  account_name: string;
  account_type: ProfitLossSection;
  period_amount: number | string;
}

interface ExpenseLedgerRow {
  transaction_id: string;
  branch_id: string | null;
  branch_name: string;
  currency_code: string;
  account_id: string;
  transaction_date: string;
  description: string;
  reference_type: string;
  reference_id: string | null;
  payment_method: string | null;
  supplier_name: string | null;
  amount: number | string;
  is_expense_source: boolean;
}

const buildGroup = (key: string, rows: LedgerRow[], expenseRows: ExpenseLedgerRow[]): ProfitLossGroup => {
  const first = rows[0];
  const lines = rows
    .map((row) => ({
      accountId: row.account_id,
      code: row.account_code,
      name: row.account_name,
      section: row.account_type,
      amount: Number(row.period_amount),
    }))
    .sort((a, b) => a.code.localeCompare(b.code));
  const total = (section: ProfitLossSection) =>
    lines.filter((line) => line.section === section).reduce((sum, line) => sum + line.amount, 0);
  const revenue = total("revenue");
  const cogs = total("cogs");
  const expenses = total("expense");
  const grossProfit = revenue - cogs;
  const netProfit = grossProfit - expenses;

  return {
    key,
    branchId: first?.branch_id ?? null,
    branchName: first?.branch_name ?? "Unassigned",
    currencyCode: first?.currency_code ?? "SAR",
    lines,
    expenseLines: expenseRows.map((row) => ({
      transactionId: row.transaction_id,
      branchId: row.branch_id,
      branchName: row.branch_name,
      currencyCode: row.currency_code,
      accountId: row.account_id,
      transactionDate: row.transaction_date,
      description: row.description,
      referenceType: row.reference_type,
      referenceId: row.reference_id,
      paymentMethod: row.payment_method,
      supplierName: row.supplier_name,
      amount: Number(row.amount),
      isExpenseSource: row.is_expense_source,
    })),
    revenue,
    cogs,
    grossProfit,
    expenses,
    netProfit,
    grossMargin: revenue !== 0 ? (grossProfit / revenue) * 100 : 0,
    netMargin: revenue !== 0 ? (netProfit / revenue) * 100 : 0,
  };
};

export function useProfitLossReport(fromDate: string, toDate: string, branchId: string | null) {
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id;

  const query = useQuery({
    queryKey: ["profit-loss-by-branch", tenantId, fromDate, toDate, branchId],
    enabled: Boolean(tenantId && fromDate && toDate),
    queryFn: async () => {
      if (!tenantId || !fromDate || !toDate) throw new Error("Reporting period is required");
      const args = { p_tenant_id: tenantId, p_from_date: fromDate, p_to_date: toDate, p_branch_id: branchId };
      const [statementResult, expenseResult] = await Promise.all([
        supabase.rpc("get_profit_loss_by_branch", args),
        supabase.rpc("get_profit_loss_expense_lines", args),
      ]);
      if (statementResult.error) throw statementResult.error;
      if (expenseResult.error) throw expenseResult.error;
      return {
        statementRows: (statementResult.data ?? []) as LedgerRow[],
        expenseRows: (expenseResult.data ?? []) as ExpenseLedgerRow[],
      };
    },
    staleTime: 2 * 60 * 1000,
  });

  const groups = useMemo(() => {
    const byBranchCurrency = new Map<string, LedgerRow[]>();
    for (const row of query.data?.statementRows ?? []) {
      const key = `${row.branch_id ?? "unassigned"}:${row.currency_code}`;
      const current = byBranchCurrency.get(key) ?? [];
      current.push(row);
      byBranchCurrency.set(key, current);
    }
    return Array.from(byBranchCurrency.entries()).map(([key, rows]) => {
      const first = rows[0];
      const expenseRows = (query.data?.expenseRows ?? []).filter(
        (row) => row.branch_id === (first?.branch_id ?? null) && row.currency_code === (first?.currency_code ?? "SAR"),
      );
      return buildGroup(key, rows, expenseRows);
    });
  }, [query.data]);

  return {
    groups,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    refetch: query.refetch,
  };
}