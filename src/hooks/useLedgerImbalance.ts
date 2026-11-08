import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { AccountType } from "@/hooks/useChartOfAccounts";

export interface UnbalancedBatch {
  batchId: string | null;
  /** Earliest transaction date in this batch. */
  date: string;
  description: string | null;
  referenceType: string | null;
  totalDebit: number;
  totalCredit: number;
  diff: number;
  rowCount: number;
  accounts: Array<{
    accountId: string;
    code: string;
    name: string;
    type: AccountType;
    debit: number;
    credit: number;
  }>;
}

export interface AccountTypeDiff {
  type: AccountType;
  totalDebit: number;
  totalCredit: number;
  diff: number;
}

interface Args {
  from: Date | null;
  to: Date | null;
}

type ImbalanceRow = {
  id: string;
  account_id: string;
  transaction_date: string;
  debit: number | null;
  credit: number | null;
  description: string | null;
  reference_type: string | null;
  batch_id: string | null;
  account?: { account_code: string; account_name: string; account_type: AccountType } | null;
};

/**
 * Diagnoses what's driving a trial-balance imbalance:
 *  - per account type diff (raw debits − raw credits)
 *  - any batches where Σ debits ≠ Σ credits (each batch should be self-balanced)
 *  - "orphan" transactions (no batch_id) sharing the same diff bucket
 */
export function useLedgerImbalance({ from, to }: Args) {
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id;
  const fromKey = from ? format(from, "yyyy-MM-dd") : null;
  const toKey = to ? format(to, "yyyy-MM-dd") : null;

  const query = useQuery({
    queryKey: ["ledger-imbalance", tenantId, fromKey, toKey],
    enabled: !!tenantId && !!fromKey && !!toKey,
    queryFn: async () => {
      // Page through to bypass the 1000-row default cap.
      const pageSize = 1000;
      let page = 0;
      const all: ImbalanceRow[] = [];
      while (true) {
        const { data, error } = await supabase
          .from("account_transactions")
          .select(
            "id, account_id, transaction_date, debit, credit, description, reference_type, batch_id, account:chart_of_accounts(account_code, account_name, account_type)",
          )
          .eq("tenant_id", tenantId!)
          .eq("is_voided", false)
          .gte("transaction_date", fromKey!)
          .lte("transaction_date", toKey!)
          .range(page * pageSize, page * pageSize + pageSize - 1);
        if (error) throw error;
        const batch = (data ?? []) as unknown as ImbalanceRow[];
        all.push(...batch);
        if (batch.length < pageSize) break;
        page += 1;
        if (page > 50) break;
      }
      return all;
    },
    staleTime: 1000 * 60 * 2,
  });

  const { typeDiffs, unbalancedBatches, totals } = useMemo(() => {
    const rows = query.data ?? [];

    // 1. Per account-type net diff.
    const typeAgg = new Map<AccountType, { d: number; c: number }>();
    for (const r of rows) {
      const type = (r.account?.account_type ?? "asset") as AccountType;
      const cur = typeAgg.get(type) ?? { d: 0, c: 0 };
      cur.d += Number(r.debit ?? 0);
      cur.c += Number(r.credit ?? 0);
      typeAgg.set(type, cur);
    }
    const typeDiffs: AccountTypeDiff[] = Array.from(typeAgg.entries())
      .map(([type, v]) => ({ type, totalDebit: v.d, totalCredit: v.c, diff: v.d - v.c }))
      .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

    // 2. Group by batch_id; orphan rows (null batch_id) are isolated per id.
    const batchAgg = new Map<string, ImbalanceRow[]>();
    for (const r of rows) {
      const key = r.batch_id ?? `__orphan_${r.id}`;
      const arr = batchAgg.get(key) ?? [];
      arr.push(r);
      batchAgg.set(key, arr);
    }

    const unbalancedBatches: UnbalancedBatch[] = [];
    for (const [key, group] of batchAgg) {
      const totalDebit = group.reduce((s, r) => s + Number(r.debit ?? 0), 0);
      const totalCredit = group.reduce((s, r) => s + Number(r.credit ?? 0), 0);
      const diff = totalDebit - totalCredit;
      if (Math.abs(diff) < 0.01) continue;
      // Aggregate per-account inside the batch.
      const acctAgg = new Map<string, { code: string; name: string; type: AccountType; d: number; c: number }>();
      for (const r of group) {
        const cur = acctAgg.get(r.account_id) ?? {
          code: r.account?.account_code ?? "?",
          name: r.account?.account_name ?? "Unknown account",
          type: (r.account?.account_type ?? "asset") as AccountType,
          d: 0,
          c: 0,
        };
        cur.d += Number(r.debit ?? 0);
        cur.c += Number(r.credit ?? 0);
        acctAgg.set(r.account_id, cur);
      }
      const earliest = group.reduce((min, r) =>
        r.transaction_date < min ? r.transaction_date : min,
        group[0].transaction_date,
      );
      const first = group[0];
      unbalancedBatches.push({
        batchId: key.startsWith("__orphan_") ? null : key,
        date: earliest,
        description: first.description,
        referenceType: first.reference_type,
        totalDebit,
        totalCredit,
        diff,
        rowCount: group.length,
        accounts: Array.from(acctAgg.entries()).map(([accountId, v]) => ({
          accountId,
          code: v.code,
          name: v.name,
          type: v.type,
          debit: v.d,
          credit: v.c,
        })),
      });
    }
    unbalancedBatches.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

    const totalDebit = rows.reduce((s, r) => s + Number(r.debit ?? 0), 0);
    const totalCredit = rows.reduce((s, r) => s + Number(r.credit ?? 0), 0);

    return {
      typeDiffs,
      unbalancedBatches,
      totals: {
        debit: totalDebit,
        credit: totalCredit,
        diff: totalDebit - totalCredit,
      },
    };
  }, [query.data]);

  return {
    typeDiffs,
    unbalancedBatches,
    totals,
    isLoading: query.isLoading,
    error: query.error,
  };
}