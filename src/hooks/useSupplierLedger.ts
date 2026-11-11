import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";

import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";

export interface SupplierOption {
  id: string;
  name: string;
  apAccountId: string | null;
  apAccountCode: string | null;
  apAccountName: string | null;
}

export interface LedgerLine {
  id: string;
  date: string;
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: string | null;
  debit: number;
  credit: number;
  description: string | null;
  batchId: string | null;
  branchId: string | null;
  isVoided: boolean;
}

export interface SupplierLedgerEntry {
  expenseId: string;
  supplierId: string;
  supplierName: string;
  description: string;
  expenseDate: string;
  branchId: string | null;
  branchName: string | null;
  amount: number;
  vatAmount: number;
  paidAmount: number;
  isPosted: boolean;
  lines: LedgerLine[];
  totalDebit: number;
  totalCredit: number;
  balanced: boolean;
}

export type SupplierPostingStatus = "complete" | "unbalanced" | "gaps" | "none";

interface Args {
  supplierId: string | "all";
  from: Date;
  to: Date;
  branchId?: string | null;
}

const chunk = <T,>(arr: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

export function useSupplierLedger({ supplierId, from, to, branchId }: Args) {
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id;
  const fromKey = format(from, "yyyy-MM-dd");
  const toKey = format(to, "yyyy-MM-dd");
  const branchKey = branchId && branchId !== "all" ? branchId : null;

  const suppliersQuery = useQuery({
    queryKey: ["supplier-ledger-suppliers", tenantId],
    enabled: !!tenantId,
    staleTime: 1000 * 60 * 5,
    queryFn: async (): Promise<SupplierOption[]> => {
      const { data, error } = await db
        .from("suppliers")
        .select("id, name, ap_account_id")
        .order("name");
      if (error) throw error;
      const accountIds = (data ?? []).map((s) => s.ap_account_id).filter(Boolean) as string[];
      let accounts: Record<string, { code: string; name: string }> = {};
      if (accountIds.length) {
        const { data: accs } = await db
          .from("chart_of_accounts")
          .select("id, account_code, account_name")
          .in("id", accountIds);
        accounts = Object.fromEntries(
          (accs ?? []).map((a) => [a.id, { code: a.account_code, name: a.account_name }]),
        );
      }
      return (data ?? []).map((s) => ({
        id: s.id,
        name: s.name,
        apAccountId: s.ap_account_id ?? null,
        apAccountCode: s.ap_account_id ? accounts[s.ap_account_id]?.code ?? null : null,
        apAccountName: s.ap_account_id ? accounts[s.ap_account_id]?.name ?? null : null,
      }));
    },
  });

  const ledgerQuery = useQuery({
    queryKey: ["supplier-ledger", tenantId, supplierId, fromKey, toKey, branchKey],
    enabled: !!tenantId,
    staleTime: 1000 * 60 * 2,
    queryFn: async () => {
      // 1. Expenses that carry a supplier
      let expQ = db
        .from("expenses")
        .select(
          "id, supplier_id, description, expense_date, amount, vat_amount, paid_amount, branch_id, ledger_posted",
        )
        .eq("tenant_id", tenantId!)
        .is("deleted_at", null)
        .not("supplier_id", "is", null)
        .gte("expense_date", fromKey)
        .lte("expense_date", toKey);
      if (supplierId !== "all") expQ = expQ.eq("supplier_id", supplierId);
      if (branchKey) expQ = expQ.eq("branch_id", branchKey);
      const { data: expenses, error: expErr } = await expQ.order("expense_date", {
        ascending: false,
      });
      if (expErr) throw expErr;
      if (!expenses?.length) return { entries: [] as SupplierLedgerEntry[] };

      const expenseIds = expenses.map((e) => e.id);

      // 2. Every ledger leg referencing those expenses (settlements included)
      const legs: any[] = [];
      for (const ids of chunk(expenseIds, 150)) {
        const { data, error } = await db
          .from("account_transactions")
          .select(
            "id, account_id, reference_id, transaction_date, debit, credit, description, batch_id, branch_id, is_voided",
          )
          .eq("tenant_id", tenantId!)
          .in("reference_id", ids)
          .order("transaction_date", { ascending: true });
        if (error) throw error;
        legs.push(...(data ?? []));
      }

      // 3. Account metadata
      const accountIds = Array.from(new Set(legs.map((l) => l.account_id)));
      const accountMap: Record<string, { code: string; name: string; type: string }> = {};
      for (const ids of chunk(accountIds, 200)) {
        const { data } = await db
          .from("chart_of_accounts")
          .select("id, account_code, account_name, account_type")
          .in("id", ids);
        for (const a of data ?? [])
          accountMap[a.id] = {
            code: a.account_code,
            name: a.account_name,
            type: a.account_type as string,
          };
      }

      // 4. Supplier + branch names (fetched here so names never depend on the
      // suppliers query having resolved first)
      const supplierIds = Array.from(
        new Set(expenses.map((e) => e.supplier_id).filter(Boolean)),
      ) as string[];
      const supplierMap: Record<string, string> = Object.fromEntries(
        (suppliersQuery.data ?? []).map((s) => [s.id, s.name]),
      );
      if (supplierIds.length) {
        const { data } = await db.from("suppliers").select("id, name").in("id", supplierIds);
        for (const s of data ?? []) supplierMap[s.id] = s.name;
      }
      const branchIds = Array.from(
        new Set(expenses.map((e) => e.branch_id).filter(Boolean)),
      ) as string[];
      let branchMap: Record<string, string> = {};
      if (branchIds.length) {
        const { data } = await db.from("branches").select("id, name").in("id", branchIds);
        branchMap = Object.fromEntries((data ?? []).map((b) => [b.id, b.name]));
      }

      const legsByExpense = new Map<string, LedgerLine[]>();
      for (const l of legs) {
        const meta = accountMap[l.account_id];
        const line: LedgerLine = {
          id: l.id,
          date: l.transaction_date,
          accountId: l.account_id,
          accountCode: meta?.code ?? "—",
          accountName: meta?.name ?? "Unknown account",
          accountType: meta?.type ?? null,
          debit: Number(l.debit ?? 0),
          credit: Number(l.credit ?? 0),
          description: l.description,
          batchId: l.batch_id,
          branchId: l.branch_id,
          isVoided: !!l.is_voided,
        };
        const arr = legsByExpense.get(l.reference_id) ?? [];
        arr.push(line);
        legsByExpense.set(l.reference_id, arr);
      }

      const entries: SupplierLedgerEntry[] = expenses.map((e) => {
        const lines = (legsByExpense.get(e.id) ?? []).sort((a, b) =>
          a.date === b.date ? b.debit - a.debit : a.date.localeCompare(b.date),
        );
        const active = lines.filter((l) => !l.isVoided);
        const totalDebit = active.reduce((s, l) => s + l.debit, 0);
        const totalCredit = active.reduce((s, l) => s + l.credit, 0);
        return {
          expenseId: e.id,
          supplierId: e.supplier_id as string,
          supplierName: supplierMap[e.supplier_id as string] ?? "Unknown supplier",
          description: e.description ?? "",
          expenseDate: e.expense_date,
          branchId: e.branch_id,
          branchName: e.branch_id ? branchMap[e.branch_id] ?? null : null,
          amount: Number(e.amount ?? 0),
          vatAmount: Number(e.vat_amount ?? 0),
          paidAmount: Number(e.paid_amount ?? 0),
          isPosted: !!e.ledger_posted && active.length > 0,
          lines,
          totalDebit,
          totalCredit,
          balanced: Math.abs(totalDebit - totalCredit) < 0.005,
        };
      });

      return { entries };
    },
  });

  const entries = ledgerQuery.data?.entries ?? [];

  const summary = useMemo(() => {
    const bySupplier = new Map<
      string,
      {
        supplierId: string;
        supplierName: string;
        billed: number;
        settled: number;
        entries: number;
        postedEntries: number;
        unpostedEntries: number;
        unbalancedEntries: number;
        unpostedAmount: number;
      }
    >();
    for (const e of entries) {
      const apLines = e.lines.filter(
        (l) => !l.isVoided && l.accountType === "liability" && l.accountCode.startsWith("2"),
      );
      const billed = apLines.reduce((s, l) => s + l.credit, 0);
      const settled = apLines.reduce((s, l) => s + l.debit, 0);
      const cur =
        bySupplier.get(e.supplierId) ?? {
          supplierId: e.supplierId,
          supplierName: e.supplierName,
          billed: 0,
          settled: 0,
          entries: 0,
          postedEntries: 0,
          unpostedEntries: 0,
          unbalancedEntries: 0,
          unpostedAmount: 0,
        };
      cur.billed += billed;
      cur.settled += settled;
      cur.entries += 1;
      if (e.isPosted) cur.postedEntries += 1;
      else {
        cur.unpostedEntries += 1;
        cur.unpostedAmount += e.amount;
      }
      if (e.lines.length > 0 && !e.balanced) cur.unbalancedEntries += 1;
      bySupplier.set(e.supplierId, cur);
    }
    const rows = Array.from(bySupplier.values())
      .map((r) => {
        const postingStatus: SupplierPostingStatus =
          r.unbalancedEntries > 0
            ? "unbalanced"
            : r.unpostedEntries > 0
              ? r.postedEntries > 0
                ? "gaps"
                : "none"
              : "complete";
        return { ...r, open: r.billed - r.settled, postingStatus };
      })
      .sort((a, b) => b.open - a.open);
    return {
      rows,
      totalBilled: rows.reduce((s, r) => s + r.billed, 0),
      totalSettled: rows.reduce((s, r) => s + r.settled, 0),
      totalOpen: rows.reduce((s, r) => s + r.open, 0),
      unpostedCount: entries.filter((e) => !e.isPosted).length,
      unbalancedCount: entries.filter((e) => e.lines.length > 0 && !e.balanced).length,
    };
  }, [entries]);

  return {
    suppliers: suppliersQuery.data ?? [],
    entries,
    ...summary,
    isLoading: ledgerQuery.isLoading || suppliersQuery.isLoading,
    refetch: ledgerQuery.refetch,
  };
}
