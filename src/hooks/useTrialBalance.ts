import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";

import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import type { AccountType } from "@/hooks/useChartOfAccounts";

export interface TrialBalanceRow {
  accountId: string;
  code: string;
  name: string;
  type: AccountType;
  /** Signed opening balance on the account's normal side (all posted entries before `from`). */
  openingBalance: number;
  totalDebit: number;
  totalCredit: number;
  /** Net balance expressed on the account's normal side (signed; negative = abnormal balance). */
  netBalance: number;
  /** Opening + period movement, signed on the account's normal side. */
  closingBalance: number;
  /** "debit" or "credit" - which column to display netBalance in. */
  side: "debit" | "credit";
  /** Absolute amount to show in the debit column on the trial balance. */
  debitAmount: number;
  /** Absolute amount to show in the credit column on the trial balance. */
  creditAmount: number;
  /** True for the computed "retained earnings brought forward" balancing row. */
  isDerived?: boolean;
  /** Per-branch period balances, signed on the account's normal side. */
  branchBalances: Record<string, { debit: number; credit: number; net: number }>;
}

/** Synthetic account id for the computed retained-earnings opening row. */
export const RETAINED_EARNINGS_BF_ID = "__retained_earnings_bf__";

/** Bucket key for ledger rows that carry no branch_id. */
export const UNASSIGNED_BRANCH_ID = "__unassigned__";

export const ACCOUNT_NORMAL_SIDE: Record<AccountType, "debit" | "credit"> = {
  asset: "debit",
  expense: "debit",
  cogs: "debit",
  liability: "credit",
  equity: "credit",
  revenue: "credit",
};

interface UseTrialBalanceArgs {
  from: Date | null;
  to: Date | null;
  /** If true, also include accounts with zero movement in the period. */
  includeZero?: boolean;
  /** Optional branch filter. "all" / null / undefined = consolidated across branches. */
  branchId?: string | null;
}

export function useTrialBalance({ from, to, includeZero = false, branchId }: UseTrialBalanceArgs) {
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id;

  const fromKey = from ? format(from, "yyyy-MM-dd") : null;
  const toKey = to ? format(to, "yyyy-MM-dd") : null;
  const branchKey = branchId && branchId !== "all" ? branchId : null;

  const accountsQuery = useQuery({
    queryKey: ["trial-balance-coa", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await db
        .from("chart_of_accounts")
        .select("id, account_code, account_name, account_type, is_active")
        .eq("tenant_id", tenantId!)
        .eq("is_active", true)
        .order("account_code", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 1000 * 60 * 5,
  });

  const txQuery = useQuery({
    queryKey: ["trial-balance-tx", tenantId, fromKey, toKey, branchKey],
    enabled: !!tenantId && !!fromKey && !!toKey,
    queryFn: async () => {
      // Page through rows to bypass the 1000-row default cap.
      const pageSize = 1000;
      let page = 0;
      const all: Array<{ account_id: string; debit: number | null; credit: number | null; branch_id: string | null }> = [];
      while (true) {
        let q = db
          .from("account_transactions")
          .select("account_id, debit, credit, branch_id")
          .eq("tenant_id", tenantId!)
          .eq("is_voided", false)
          .gte("transaction_date", fromKey!)
          .lte("transaction_date", toKey!);
        if (branchKey) q = q.eq("branch_id", branchKey);
        const { data, error } = await q.range(
          page * pageSize,
          page * pageSize + pageSize - 1,
        );
        if (error) throw error;
        const batch = data ?? [];
        all.push(...batch);
        if (batch.length < pageSize) break;
        page += 1;
        if (page > 50) break; // safety stop at 50k rows
      }
      return all;
    },
    staleTime: 1000 * 60 * 2,
  });

  // Opening balances: every posted entry strictly before the period start.
  const openingQuery = useQuery({
    queryKey: ["trial-balance-opening", tenantId, fromKey, branchKey],
    enabled: !!tenantId && !!fromKey,
    queryFn: async () => {
      const pageSize = 1000;
      let page = 0;
      const all: Array<{ account_id: string; debit: number | null; credit: number | null }> = [];
      while (true) {
        let q = db
          .from("account_transactions")
          .select("account_id, debit, credit")
          .eq("tenant_id", tenantId!)
          .eq("is_voided", false)
          .lt("transaction_date", fromKey!);
        if (branchKey) q = q.eq("branch_id", branchKey);
        const { data, error } = await q.range(
          page * pageSize,
          page * pageSize + pageSize - 1,
        );
        if (error) throw error;
        const batch = data ?? [];
        all.push(...batch);
        if (batch.length < pageSize) break;
        page += 1;
        if (page > 50) break;
      }
      return all;
    },
    staleTime: 1000 * 60 * 2,
  });

  const rows = useMemo<TrialBalanceRow[]>(() => {
    const accounts = accountsQuery.data ?? [];
    const tx = txQuery.data ?? [];
    const openingTx = openingQuery.data ?? [];

    const totals = new Map<string, { d: number; c: number }>();
    const branchTotals = new Map<string, Map<string, { d: number; c: number }>>();
    for (const t of tx) {
      const cur = totals.get(t.account_id) ?? { d: 0, c: 0 };
      cur.d += Number(t.debit ?? 0);
      cur.c += Number(t.credit ?? 0);
      totals.set(t.account_id, cur);

      const bKey = (t as any).branch_id ?? UNASSIGNED_BRANCH_ID;
      const perAccount = branchTotals.get(t.account_id) ?? new Map();
      const bCur = perAccount.get(bKey) ?? { d: 0, c: 0 };
      bCur.d += Number(t.debit ?? 0);
      bCur.c += Number(t.credit ?? 0);
      perAccount.set(bKey, bCur);
      branchTotals.set(t.account_id, perAccount);
    }

    const openingTotals = new Map<string, { d: number; c: number }>();
    for (const t of openingTx) {
      const cur = openingTotals.get(t.account_id) ?? { d: 0, c: 0 };
      cur.d += Number(t.debit ?? 0);
      cur.c += Number(t.credit ?? 0);
      openingTotals.set(t.account_id, cur);
    }

    const out: TrialBalanceRow[] = [];
    for (const a of accounts) {
      const t = totals.get(a.id) ?? { d: 0, c: 0 };
      const o = openingTotals.get(a.id) ?? { d: 0, c: 0 };
      const type = a.account_type as AccountType;
      const side = ACCOUNT_NORMAL_SIDE[type];
      const opening = side === "debit" ? o.d - o.c : o.c - o.d;
      if (!includeZero && t.d === 0 && t.c === 0 && Math.abs(opening) < 0.005) continue;
      const net = side === "debit" ? t.d - t.c : t.c - t.d;
      const perBranch: Record<string, { debit: number; credit: number; net: number }> = {};
      for (const [bId, bt] of branchTotals.get(a.id) ?? []) {
        perBranch[bId] = {
          debit: bt.d,
          credit: bt.c,
          net: side === "debit" ? bt.d - bt.c : bt.c - bt.d,
        };
      }
      out.push({
        branchBalances: perBranch,
        accountId: a.id,
        code: a.account_code,
        name: a.account_name,
        type,
        openingBalance: opening,
        totalDebit: t.d,
        totalCredit: t.c,
        netBalance: net,
        closingBalance: opening + net,
        side,
        debitAmount: side === "debit" ? Math.max(net, 0) : Math.max(-net, 0),
        creditAmount: side === "credit" ? Math.max(net, 0) : Math.max(-net, 0),
      });
    }
    // Prior-period profit/loss is not closed to equity in a live ledger, so the
    // opening column would otherwise show Dr <> Cr by exactly the accumulated
    // result. Surface it as a computed "retained earnings brought forward" row
    // instead of leaving the statement looking out of balance.
    const openDr = out.reduce(
      (s, r) => s + (r.side === "debit" ? Math.max(r.openingBalance, 0) : Math.max(-r.openingBalance, 0)),
      0,
    );
    const openCr = out.reduce(
      (s, r) => s + (r.side === "credit" ? Math.max(r.openingBalance, 0) : Math.max(-r.openingBalance, 0)),
      0,
    );
    const carryForward = openDr - openCr; // > 0 => credit-side equity balance
    if (Math.abs(carryForward) > 0.005) {
      out.push({
        accountId: RETAINED_EARNINGS_BF_ID,
        code: "3200",
        name: "Retained earnings brought forward (computed)",
        type: "equity",
        openingBalance: carryForward,
        totalDebit: 0,
        totalCredit: 0,
        netBalance: 0,
        closingBalance: carryForward,
        side: "credit",
        debitAmount: 0,
        creditAmount: 0,
        isDerived: true,
        branchBalances: {},
      });
    }

    return out;
  }, [accountsQuery.data, txQuery.data, openingQuery.data, includeZero]);

  const totals = useMemo(() => {
    const debit = rows.reduce((s, r) => s + r.debitAmount, 0);
    const credit = rows.reduce((s, r) => s + r.creditAmount, 0);
    const openingDebit = rows.reduce(
      (s, r) => s + (r.side === "debit" ? Math.max(r.openingBalance, 0) : Math.max(-r.openingBalance, 0)),
      0,
    );
    const openingCredit = rows.reduce(
      (s, r) => s + (r.side === "credit" ? Math.max(r.openingBalance, 0) : Math.max(-r.openingBalance, 0)),
      0,
    );
    const closingDebit = rows.reduce(
      (s, r) => s + (r.side === "debit" ? Math.max(r.closingBalance, 0) : Math.max(-r.closingBalance, 0)),
      0,
    );
    const closingCredit = rows.reduce(
      (s, r) => s + (r.side === "credit" ? Math.max(r.closingBalance, 0) : Math.max(-r.closingBalance, 0)),
      0,
    );
    return {
      debit,
      credit,
      openingDebit,
      openingCredit,
      closingDebit,
      closingCredit,
      diff: debit - credit,
      balanced: Math.abs(debit - credit) < 0.01,
    };
  }, [rows]);

  const branchIds = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) for (const k of Object.keys(r.branchBalances)) set.add(k);
    return Array.from(set).sort();
  }, [rows]);

  return {
    rows,
    totals,
    branchIds,
    isLoading: accountsQuery.isLoading || txQuery.isLoading || openingQuery.isLoading,
    error: accountsQuery.error || txQuery.error || openingQuery.error,
  };
}