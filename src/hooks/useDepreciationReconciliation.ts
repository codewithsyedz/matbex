import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";

/** Untyped client: fixed asset tables are newer than the generated types. */
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface ReconciliationAccountLine {
  accountId: string;
  accountCode: string;
  accountName: string;
  /** Signed movement in the selected month (expense: DR−CR, accumulated: CR−DR). */
  periodMovement: number;
  /** Signed balance up to and including the period end. */
  balanceToDate: number;
  entryCount: number;
}

export interface DepreciationReconciliation {
  /** Report-side figures (from the asset register schedule). */
  registerPeriodExpense: number;
  registerAccumulated: number;
  /** Ledger-side figures. */
  ledgerPeriodExpense: number;
  ledgerAccumulated: number;
  /** Register − ledger. */
  expenseVariance: number;
  accumulatedVariance: number;
  balanced: boolean;
  expenseLines: ReconciliationAccountLine[];
  accumulatedLines: ReconciliationAccountLine[];
  isLoading: boolean;
  error: unknown;
}

interface Args {
  /** First day of the reporting month, ISO (yyyy-MM-01). */
  period: string;
  /** Last day of the reporting month, ISO. */
  periodEndKey: string;
  branchId?: string | null;
  /** Totals coming from useDepreciationReport for the same filters. */
  registerPeriodExpense: number;
  registerAccumulated: number;
  /** Tolerance in currency units before flagging a mismatch. */
  tolerance?: number;
}

/**
 * Ties the depreciation schedule back to the general ledger: compares the
 * register's period charge against depreciation expense accounts, and the
 * register's accumulated depreciation against the accumulated depreciation
 * (contra-asset) accounts for the same month and branch scope.
 */
export function useDepreciationReconciliation({
  period,
  periodEndKey,
  branchId,
  registerPeriodExpense,
  registerAccumulated,
  tolerance = 0.05,
}: Args): DepreciationReconciliation {
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id;
  const branchKey = branchId && branchId !== "all" ? branchId : null;

  const accountsQuery = useQuery({
    queryKey: ["depreciation-recon-accounts", tenantId],
    enabled: !!tenantId,
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      const [{ data: classes, error: classErr }, { data: coa, error: coaErr }] = await Promise.all([
        db
          .from("fixed_asset_classes")
          .select("accum_dep_account_id, dep_expense_account_id")
          .eq("tenant_id", tenantId),
        db
          .from("chart_of_accounts")
          .select("id, account_code, account_name, account_type")
          .eq("tenant_id", tenantId),
      ]);
      if (classErr) throw classErr;
      if (coaErr) throw coaErr;

      const expenseIds = new Set<string>();
      const accumIds = new Set<string>();
      for (const c of (classes ?? []) as any[]) {
        if (c.dep_expense_account_id) expenseIds.add(c.dep_expense_account_id);
        if (c.accum_dep_account_id) accumIds.add(c.accum_dep_account_id);
      }

      // Fall back to the standard Matbex account codes when a class has no mapping yet.
      for (const a of (coa ?? []) as any[]) {
        const code = String(a.account_code ?? "");
        if (/^67[0-9]{2}$/.test(code)) expenseIds.add(a.id);
        if (/^16[0-9]{2}$/.test(code)) accumIds.add(a.id);
      }

      const meta = new Map<string, { code: string; name: string }>(
        ((coa ?? []) as any[]).map((a) => [
          a.id as string,
          { code: String(a.account_code ?? ""), name: String(a.account_name ?? "") },
        ]),
      );

      return {
        expenseIds: Array.from(expenseIds),
        accumIds: Array.from(accumIds),
        meta,
      };
    },
  });

  const accountIds = useMemo(() => {
    const a = accountsQuery.data;
    return a ? [...a.expenseIds, ...a.accumIds] : [];
  }, [accountsQuery.data]);

  const txQuery = useQuery({
    queryKey: ["depreciation-recon-tx", tenantId, period, periodEndKey, branchKey, accountIds.length],
    enabled: !!tenantId && accountIds.length > 0,
    staleTime: 1000 * 60 * 2,
    queryFn: async () => {
      let q = db
        .from("account_transactions")
        .select("account_id, transaction_date, debit, credit, branch_id, is_voided")
        .eq("tenant_id", tenantId)
        .eq("is_voided", false)
        .in("account_id", accountIds)
        .lte("transaction_date", periodEndKey);
      if (branchKey) q = q.eq("branch_id", branchKey);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  return useMemo(() => {
    const cfg = accountsQuery.data;
    const tx = txQuery.data ?? [];
    const expenseSet = new Set(cfg?.expenseIds ?? []);
    const accumSet = new Set(cfg?.accumIds ?? []);

    const build = (ids: Set<string>, sign: "debit" | "credit"): ReconciliationAccountLine[] => {
      const map = new Map<string, ReconciliationAccountLine>();
      for (const t of tx) {
        if (!ids.has(t.account_id)) continue;
        const dr = Number(t.debit || 0);
        const cr = Number(t.credit || 0);
        const signed = sign === "debit" ? dr - cr : cr - dr;
        const inPeriod =
          String(t.transaction_date) >= period && String(t.transaction_date) <= periodEndKey;
        let line = map.get(t.account_id);
        if (!line) {
          const m = cfg?.meta.get(t.account_id);
          line = {
            accountId: t.account_id,
            accountCode: m?.code ?? "—",
            accountName: m?.name ?? "Unmapped account",
            periodMovement: 0,
            balanceToDate: 0,
            entryCount: 0,
          };
          map.set(t.account_id, line);
        }
        line.balanceToDate = round2(line.balanceToDate + signed);
        if (inPeriod) {
          line.periodMovement = round2(line.periodMovement + signed);
          line.entryCount += 1;
        }
      }
      return Array.from(map.values())
        .filter((l) => Math.abs(l.balanceToDate) > 0.004 || Math.abs(l.periodMovement) > 0.004)
        .sort((a, b) => a.accountCode.localeCompare(b.accountCode));
    };

    const expenseLines = build(expenseSet, "debit");
    const accumulatedLines = build(accumSet, "credit");

    const ledgerPeriodExpense = round2(
      expenseLines.reduce((s, l) => s + l.periodMovement, 0),
    );
    const ledgerAccumulated = round2(
      accumulatedLines.reduce((s, l) => s + l.balanceToDate, 0),
    );

    const expenseVariance = round2(registerPeriodExpense - ledgerPeriodExpense);
    const accumulatedVariance = round2(registerAccumulated - ledgerAccumulated);

    return {
      registerPeriodExpense: round2(registerPeriodExpense),
      registerAccumulated: round2(registerAccumulated),
      ledgerPeriodExpense,
      ledgerAccumulated,
      expenseVariance,
      accumulatedVariance,
      balanced:
        Math.abs(expenseVariance) <= tolerance && Math.abs(accumulatedVariance) <= tolerance,
      expenseLines,
      accumulatedLines,
      isLoading: accountsQuery.isLoading || txQuery.isLoading,
      error: accountsQuery.error ?? txQuery.error ?? null,
    };
  }, [
    accountsQuery.data,
    accountsQuery.isLoading,
    accountsQuery.error,
    txQuery.data,
    txQuery.isLoading,
    txQuery.error,
    period,
    periodEndKey,
    registerPeriodExpense,
    registerAccumulated,
    tolerance,
  ]);
}
