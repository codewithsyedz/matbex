import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";

import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/integrations/db/client";

export type CashFlowSection = "operating" | "investing" | "financing";
export type CashFlowDetail =
  | "netIncome"
  | "increaseAsset"
  | "decreaseAsset"
  | "increaseLiabilityEquity"
  | "decreaseLiabilityEquity";

export interface CashFlowLine {
  accountId: string;
  code: string;
  name: string;
  cashImpact: number;
  detail: CashFlowDetail;
}

export interface CashFlowSectionData {
  section: CashFlowSection;
  lines: CashFlowLine[];
  total: number;
}

export interface CashAccountMovement {
  accountId: string;
  code: string;
  name: string;
  opening: number;
  movement: number;
  closing: number;
}

export interface CashFlowGroup {
  key: string;
  branchId: string | null;
  branchName: string;
  currencyCode: string;
  sections: CashFlowSectionData[];
  operating: number;
  investing: number;
  financing: number;
  netChange: number;
  openingCash: number;
  closingCash: number;
  actualCashMovement: number;
  variance: number;
  cashAccounts: CashAccountMovement[];
}

interface LedgerRow {
  branch_id: string | null;
  branch_name: string;
  currency_code: string;
  account_id: string;
  account_code: string;
  account_name: string;
  account_type: "asset" | "liability" | "equity" | "revenue" | "cogs" | "expense";
  is_fixed_asset_account: boolean;
  opening_balance: number | string;
  period_movement: number | string;
  closing_balance: number | string;
}

const numberCode = (code: string) => {
  const value = Number.parseInt(code.replace(/\D/g, ""), 10);
  return Number.isFinite(value) ? value : 0;
};

const isCashAccount = (row: LedgerRow) => {
  if (row.account_type !== "asset") return false;
  const code = numberCode(row.account_code);
  return code >= 1000 && code <= 1049 && code !== 1015;
};

const classifySection = (row: LedgerRow): CashFlowSection => {
  const code = numberCode(row.account_code);
  if (row.account_type === "equity") return "financing";
  if (row.account_type === "asset" && (row.is_fixed_asset_account || code >= 1500)) return "investing";
  if (row.account_type === "liability" && code >= 2700) return "financing";
  return "operating";
};

const buildGroup = (key: string, rows: LedgerRow[]): CashFlowGroup => {
  const first = rows[0];
  const cashRows = rows.filter(isCashAccount);
  const openingCash = cashRows.reduce((sum, row) => sum + Number(row.opening_balance), 0);
  const closingCash = cashRows.reduce((sum, row) => sum + Number(row.closing_balance), 0);

  const netIncome = rows.reduce((sum, row) => {
    const movement = Number(row.period_movement);
    if (row.account_type === "revenue") return sum + movement;
    if (row.account_type === "cogs" || row.account_type === "expense") return sum - movement;
    return sum;
  }, 0);

  const buckets: Record<CashFlowSection, CashFlowLine[]> = {
    operating: [],
    investing: [],
    financing: [],
  };

  for (const row of rows) {
    if (isCashAccount(row) || ["revenue", "cogs", "expense"].includes(row.account_type)) continue;
    const movement = Number(row.period_movement);
    if (Math.abs(movement) < 0.005) continue;
    const debitNatural = row.account_type === "asset";
    const cashImpact = debitNatural ? -movement : movement;
    buckets[classifySection(row)].push({
      accountId: row.account_id,
      code: row.account_code,
      name: row.account_name,
      cashImpact,
      detail: movement > 0
        ? debitNatural ? "increaseAsset" : "increaseLiabilityEquity"
        : debitNatural ? "decreaseAsset" : "decreaseLiabilityEquity",
    });
  }

  if (Math.abs(netIncome) >= 0.005) {
    buckets.operating.unshift({
      accountId: `net-income-${key}`,
      code: "—",
      name: "Net income for the period",
      cashImpact: netIncome,
      detail: "netIncome",
    });
  }

  const sections = (["operating", "investing", "financing"] as CashFlowSection[]).map((section) => {
    const lines = buckets[section].sort((a, b) => Math.abs(b.cashImpact) - Math.abs(a.cashImpact));
    return { section, lines, total: lines.reduce((sum, line) => sum + line.cashImpact, 0) };
  });
  const totalFor = (section: CashFlowSection) => sections.find((item) => item.section === section)?.total ?? 0;
  const netChange = sections.reduce((sum, section) => sum + section.total, 0);
  const actualCashMovement = closingCash - openingCash;

  return {
    key,
    branchId: first?.branch_id ?? null,
    branchName: first?.branch_name ?? "Unassigned",
    currencyCode: first?.currency_code ?? "SAR",
    sections,
    operating: totalFor("operating"),
    investing: totalFor("investing"),
    financing: totalFor("financing"),
    netChange,
    openingCash,
    closingCash,
    actualCashMovement,
    variance: actualCashMovement - netChange,
    cashAccounts: cashRows.map((row) => ({
      accountId: row.account_id,
      code: row.account_code,
      name: row.account_name,
      opening: Number(row.opening_balance),
      movement: Number(row.closing_balance) - Number(row.opening_balance),
      closing: Number(row.closing_balance),
    })),
  };
};

export function useCashFlow(from: Date | null, to: Date | null, branchId: string | null) {
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id;
  const fromDate = from ? format(from, "yyyy-MM-dd") : null;
  const toDate = to ? format(to, "yyyy-MM-dd") : null;

  const query = useQuery({
    queryKey: ["cash-flow-by-branch", tenantId, fromDate, toDate, branchId],
    enabled: Boolean(tenantId && fromDate && toDate),
    queryFn: async () => {
      if (!tenantId || !fromDate || !toDate) throw new Error("Reporting period is required");
      const { data, error } = await db.rpc("get_cash_flow_by_branch", {
        p_tenant_id: tenantId,
        p_from_date: fromDate,
        p_to_date: toDate,
        p_branch_id: branchId,
      });
      if (error) throw error;
      return (data ?? []) as LedgerRow[];
    },
    staleTime: 2 * 60 * 1000,
  });

  const groups = useMemo(() => {
    const byBranch = new Map<string, LedgerRow[]>();
    for (const row of query.data ?? []) {
      const key = `${row.branch_id ?? "unassigned"}:${row.currency_code}`;
      const current = byBranch.get(key) ?? [];
      current.push(row);
      byBranch.set(key, current);
    }
    return Array.from(byBranch.entries()).map(([key, rows]) => buildGroup(key, rows));
  }, [query.data]);

  return {
    groups,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    refetch: query.refetch,
  };
}